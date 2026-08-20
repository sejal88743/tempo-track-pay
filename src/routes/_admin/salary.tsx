import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Wallet, Printer, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  getSalaries,
  upsertSalary,
  getEmployees,
  useCloudSync,
  type SalaryRecord,
} from "@/lib/store";
import { generateSalaries } from "@/lib/salary-calc";
import { useSortable, SortHeader } from "@/lib/use-sort";

export const Route = createFileRoute("/_admin/salary")({ component: SalaryPage });

type RowWithName = SalaryRecord & { emp_name: string };

function SalaryPage() {
  useCloudSync();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [rows, setRows] = useState<RowWithName[]>([]);

  const reload = () => {
    const emps = getEmployees();
    const empMap = new Map(emps.map((e) => [e.id, e.full_name]));
    const sal = getSalaries().filter((s) => s.month === month);
    setRows(sal.map((s) => ({ ...s, emp_name: empMap.get(s.employee_id) ?? "Unknown" })));
  };

  useEffect(() => {
    reload();
  }, [month]);

  const generate = () => {
    const r = generateSalaries(month);
    toast.success(`Generated ${r.length} salary records`);
    reload();
  };

  const updateField = (id: string, field: "bonus" | "penalty", val: number) => {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    const updated = { ...row };
    updated[field] = val;
    updated.final_salary = Math.max(
      0,
      updated.gross -
        updated.leave_deduction -
        updated.advance_deducted +
        updated.bonus -
        updated.penalty,
    );
    upsertSalary(updated);
    reload();
  };

  const { sorted, sort, toggle } = useSortable<RowWithName>(rows, {
    name: (r) => r.emp_name,
    per_day: (r) => r.per_day,
    present: (r) => r.present_days,
    paid: (r) => r.paid_leave_days,
    unpaid: (r) => r.unpaid_leave_days,
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
            Formula: Per Day = Monthly ÷ Total Days • Final = Per Day × (Present + Paid Leave) −
            Unpaid − Advance + Bonus − Penalty
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
            <div className="text-3xl font-bold">₹{totalPayout.toLocaleString("en-IN")}</div>
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
                label="Paid L"
                sortKey="paid"
                sort={sort}
                toggle={toggle}
                className="text-right"
                align="right"
              />
              <SortHeader
                label="Unpaid L"
                sortKey="unpaid"
                sort={sort}
                toggle={toggle}
                className="text-right"
                align="right"
              />
              <SortHeader
                label="Gross"
                sortKey="gross"
                sort={sort}
                toggle={toggle}
                className="text-right"
                align="right"
              />
              <SortHeader
                label="Advance"
                sortKey="advance"
                sort={sort}
                toggle={toggle}
                className="text-right"
                align="right"
              />
              <SortHeader
                label="Bonus"
                sortKey="bonus"
                sort={sort}
                toggle={toggle}
                className="text-right"
                align="right"
              />
              <SortHeader
                label="Penalty"
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
                <TableCell className="text-right">{r.paid_leave_days}</TableCell>
                <TableCell className="text-right">{r.unpaid_leave_days}</TableCell>
                <TableCell className="text-right">₹{r.gross.toFixed(0)}</TableCell>
                <TableCell className="text-right text-red-600">
                  ₹{r.advance_deducted.toFixed(0)}
                </TableCell>
                <TableCell className="text-right">
                  <Input
                    className="w-20 h-7 text-right text-sm ml-auto"
                    type="number"
                    defaultValue={r.bonus}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (v !== r.bonus) updateField(r.id, "bonus", v);
                    }}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <Input
                    className="w-20 h-7 text-right text-sm ml-auto"
                    type="number"
                    defaultValue={r.penalty}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (v !== r.penalty) updateField(r.id, "penalty", v);
                    }}
                  />
                </TableCell>
                <TableCell className="text-right font-bold text-green-700">
                  ₹{r.final_salary.toLocaleString("en-IN")}
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
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
