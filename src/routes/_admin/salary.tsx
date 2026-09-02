import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { Printer, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  getSalaries,
  upsertSalary,
  getEmployees,
  getAdvances,
  saveAdvances,
  upsertAdvance,
  newId,
  useCloudSync,
  type SalaryRecord,
} from "@/lib/store";
import { generateSalaries } from "@/lib/salary-calc";
import { useSortable, SortHeader } from "@/lib/use-sort";

export const Route = createFileRoute("/_admin/salary")({ component: SalaryPage });

type RowWithName = SalaryRecord & { emp_name: string };

function SalaryPage() {
  const syncVersion = useCloudSync();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));

  const rows = useMemo(() => {
    void syncVersion;
    const emps = getEmployees();
    const empMap = new Map(emps.map((e) => [e.id, e.full_name]));
    const sal = getSalaries().filter((s) => s.month === month);
    return sal.map((s) => ({ ...s, emp_name: empMap.get(s.employee_id) ?? "Unknown" }));
  }, [month, syncVersion]);

  const generate = async () => {
    const r = await generateSalaries(month);
    toast.success(`Generated ${r.length} salary records`);
  };

  const updateField = async (
    id: string,
    field: "advance_deducted" | "bonus" | "penalty",
    val: number,
  ) => {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    const updated = { ...row };
    updated[field] = Math.max(0, val || 0);

    // Formula: Final Amount = Gross Salary - Advance Amount - Penalty + Bonus
    updated.final_salary = Math.max(
      0,
      Number(
        (updated.gross - updated.advance_deducted + updated.bonus - updated.penalty).toFixed(2),
      ),
    );
    await upsertSalary(updated);

    // If advance was edited directly, sync with advances store
    if (field === "advance_deducted") {
      const allAdv = getAdvances();
      const existingAdvIndex = allAdv.findIndex(
        (a) =>
          a.employee_id === row.employee_id &&
          ((a.deducted && a.deducted_month === month) || (a.date && a.date.startsWith(month))),
      );
      if (existingAdvIndex >= 0) {
        allAdv[existingAdvIndex].amount = updated.advance_deducted;
        allAdv[existingAdvIndex].deducted = updated.advance_deducted > 0;
        allAdv[existingAdvIndex].deducted_month = updated.advance_deducted > 0 ? month : undefined;
        await saveAdvances([...allAdv]);
      } else if (updated.advance_deducted > 0) {
        await upsertAdvance({
          id: newId(),
          employee_id: row.employee_id,
          amount: updated.advance_deducted,
          date: `${month}-01`,
          status: "approved",
          deducted: true,
          deducted_month: month,
          reason: "Salary page advance",
        });
      }
      toast.success(`Advance updated to ₹${updated.advance_deducted.toLocaleString("en-IN")}`);
    }
  };

  const { sorted, sort, toggle } = useSortable<RowWithName>(rows, {
    name: (r) => r.emp_name,
    per_day: (r) => r.per_day,
    present: (r) => r.present_days,
    gross: (r) => r.gross,
    advance: (r) => r.advance_deducted,
    bonus: (r) => r.bonus,
    penalty: (r) => r.penalty,
    final: (r) => r.final_salary,
  });

  const totalPayout = rows.reduce((s, r) => s + r.final_salary, 0);

  return (
    <div className="p-3 space-y-3">
      <div className="flex justify-between items-end flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Salary</h1>
          <p className="text-sm text-muted-foreground">
            Formula:{" "}
            <span className="font-semibold text-foreground">
              Final Amount = Gross Salary − Advance Amount − Penalty (+ Bonus)
            </span>
          </p>
        </div>
        <div className="flex gap-2 items-end">
          <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          <Button onClick={generate}>
            <RefreshCw className="size-4 mr-1" /> Generate / Recalculate
          </Button>
        </div>
      </div>

      {rows.length > 0 && (
        <Card className="p-4 flex items-center justify-between">
          <div>
            <div className="text-sm text-muted-foreground">Total Payout — {month}</div>
            <div className="text-3xl font-bold text-green-700">
              ₹{totalPayout.toLocaleString("en-IN")}
            </div>
          </div>
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="size-4 mr-1" /> Print
          </Button>
        </Card>
      )}

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <SortHeader label="Name" sortKey="name" sort={sort} toggle={toggle} />
              <SortHeader
                label="Per Day"
                sortKey="per_day"
                sort={sort}
                toggle={toggle}
                className="text-right"
                align="right"
              />
              <SortHeader
                label="Present"
                sortKey="present"
                sort={sort}
                toggle={toggle}
                className="text-right"
                align="right"
              />
              <SortHeader
                label="Gross (₹)"
                sortKey="gross"
                sort={sort}
                toggle={toggle}
                className="text-right"
                align="right"
              />
              <SortHeader
                label="Advance (₹)"
                sortKey="advance"
                sort={sort}
                toggle={toggle}
                className="text-right text-red-600"
                align="right"
              />
              <SortHeader
                label="Bonus (₹)"
                sortKey="bonus"
                sort={sort}
                toggle={toggle}
                className="text-right"
                align="right"
              />
              <SortHeader
                label="Penalty (₹)"
                sortKey="penalty"
                sort={sort}
                toggle={toggle}
                className="text-right"
                align="right"
              />
              <SortHeader
                label="Final (₹)"
                sortKey="final"
                sort={sort}
                toggle={toggle}
                className="text-right font-bold"
                align="right"
              />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.emp_name}</TableCell>
                <TableCell className="text-right">₹{r.per_day.toFixed(0)}</TableCell>
                <TableCell className="text-right">{r.present_days}</TableCell>
                <TableCell className="text-right font-medium">₹{r.gross.toFixed(0)}</TableCell>
                <TableCell className="text-right">
                  <Input
                    className="w-24 h-7 text-right text-sm ml-auto font-medium text-red-600 border-red-200 focus-visible:ring-red-400"
                    type="number"
                    min="0"
                    defaultValue={r.advance_deducted || 0}
                    key={`adv-${r.id}-${r.advance_deducted}`}
                    onBlur={(e) => {
                      const v = Math.max(0, Number(e.target.value) || 0);
                      if (v !== r.advance_deducted) updateField(r.id, "advance_deducted", v);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <Input
                    className="w-20 h-7 text-right text-sm ml-auto"
                    type="number"
                    min="0"
                    defaultValue={r.bonus || 0}
                    key={`bonus-${r.id}-${r.bonus}`}
                    onBlur={(e) => {
                      const v = Math.max(0, Number(e.target.value) || 0);
                      if (v !== r.bonus) updateField(r.id, "bonus", v);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <Input
                    className="w-20 h-7 text-right text-sm ml-auto"
                    type="number"
                    min="0"
                    defaultValue={r.penalty || 0}
                    key={`pen-${r.id}-${r.penalty}`}
                    onBlur={(e) => {
                      const v = Math.max(0, Number(e.target.value) || 0);
                      if (v !== r.penalty) updateField(r.id, "penalty", v);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                  />
                </TableCell>
                <TableCell className="text-right font-bold text-green-700 text-base">
                  ₹{r.final_salary.toLocaleString("en-IN")}
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  "Generate / Recalculate" dabao to is mahine ki salaries calculate hongi.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
