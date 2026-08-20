import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Check, X } from "lucide-react";
import { toast } from "sonner";
import { useSortable, SortHeader } from "@/lib/use-sort";
import { getAdvances, upsertAdvance, getEmployees, newId, type Advance } from "@/lib/store";

export const Route = createFileRoute("/_admin/advances")({ component: AdvancesPage });

type AdvWithName = Advance & { emp_name: string };

function AdvancesPage() {
  const [advances, setAdvances] = useState<AdvWithName[]>([]);
  const [editing, setEditing] = useState<Partial<Advance> | null>(null);
  const [employees, setEmployees] = useState<{ id: string; full_name: string }[]>([]);

  const reload = () => {
    const emps = getEmployees().filter((e) => e.active);
    const empMap = new Map(emps.map((e) => [e.id, e.full_name]));
    setEmployees(emps);
    setAdvances(
      getAdvances()
        .sort((a, b) => b.date.localeCompare(a.date))
        .map((a) => ({ ...a, emp_name: empMap.get(a.employee_id) ?? "Unknown" })),
    );
  };

  useEffect(() => {
    reload();
  }, []);

  const approve = (a: Advance) => {
    upsertAdvance({ ...a, status: "approved" });
    reload();
    toast.success("Approved");
  };
  const reject = (a: Advance) => {
    upsertAdvance({ ...a, status: "rejected" });
    reload();
    toast.success("Rejected");
  };

  const save = () => {
    if (!editing?.employee_id) {
      toast.error("Employee select karein");
      return;
    }
    if (!editing.amount || editing.amount <= 0) {
      toast.error("Amount enter karein");
      return;
    }
    upsertAdvance({
      id: editing.id ?? newId(),
      employee_id: editing.employee_id!,
      amount: Number(editing.amount),
      reason: editing.reason ?? "",
      date: editing.date ?? new Date().toISOString().slice(0, 10),
      status: editing.status ?? "approved",
      deducted: editing.deducted ?? false,
    });
    toast.success("Saved");
    setEditing(null);
    reload();
  };

  const { sorted, sort, toggle } = useSortable<AdvWithName>(advances, {
    emp: (a) => a.emp_name,
    date: (a) => a.date,
    amount: (a) => a.amount,
    reason: (a) => a.reason ?? "",
    status: (a) => a.status,
    deducted: (a) => (a.deducted ? 1 : 0),
  });

  const totalPending = advances
    .filter((a) => a.status === "approved" && !a.deducted)
    .reduce((s, a) => s + a.amount, 0);

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Advances</h1>
          <p className="text-sm text-muted-foreground">
            Pending deduction:{" "}
            <span className="font-semibold text-amber-600">
              ₹{totalPending.toLocaleString("en-IN")}
            </span>{" "}
            — Salary generate par auto-deduct hoga
          </p>
        </div>
        <Button
          onClick={() =>
            setEditing({
              status: "approved",
              deducted: false,
              date: new Date().toISOString().slice(0, 10),
              amount: 0,
            })
          }
        >
          <Plus className="size-4 mr-1" /> Add Advance
        </Button>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <SortHeader label="Employee" sortKey="emp" sort={sort} toggle={toggle} />
              <SortHeader label="Date" sortKey="date" sort={sort} toggle={toggle} />
              <SortHeader
                label="Amount (₹)"
                sortKey="amount"
                sort={sort}
                toggle={toggle}
                className="text-right"
                align="right"
              />
              <SortHeader label="Reason" sortKey="reason" sort={sort} toggle={toggle} />
              <SortHeader label="Status" sortKey="status" sort={sort} toggle={toggle} />
              <SortHeader label="Deducted?" sortKey="deducted" sort={sort} toggle={toggle} />
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="font-medium">{a.emp_name}</TableCell>
                <TableCell>{a.date}</TableCell>
                <TableCell className="text-right font-medium">
                  ₹{a.amount.toLocaleString("en-IN")}
                </TableCell>
                <TableCell className="max-w-[160px] truncate">{a.reason || "—"}</TableCell>
                <TableCell>
                  <Badge
                    variant={
                      a.status === "approved"
                        ? "default"
                        : a.status === "rejected"
                          ? "destructive"
                          : "secondary"
                    }
                    className="capitalize"
                  >
                    {a.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  {a.deducted ? (
                    <Badge variant="secondary">✓ {a.deducted_month}</Badge>
                  ) : (
                    <Badge variant="outline">No</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right space-x-1">
                  {a.status === "pending" && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => approve(a)}>
                        <Check className="size-4 text-green-600" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => reject(a)}>
                        <X className="size-4 text-red-600" />
                      </Button>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {advances.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  Koi advance record nahi.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Advance</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div>
                <Label>Employee</Label>
                <Select
                  value={editing.employee_id ?? ""}
                  onValueChange={(v) => setEditing({ ...editing, employee_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select employee" />
                  </SelectTrigger>
                  <SelectContent>
                    {employees.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Amount (₹)</Label>
                <Input
                  type="number"
                  value={editing.amount ?? 0}
                  onChange={(e) => setEditing({ ...editing, amount: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label>Date</Label>
                <Input
                  type="date"
                  value={editing.date ?? ""}
                  onChange={(e) => setEditing({ ...editing, date: e.target.value })}
                />
              </div>
              <div>
                <Label>Reason</Label>
                <Input
                  value={editing.reason ?? ""}
                  onChange={(e) => setEditing({ ...editing, reason: e.target.value })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={save}>Save (Approved)</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
