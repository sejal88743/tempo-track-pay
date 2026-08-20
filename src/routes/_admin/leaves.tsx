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
import { getLeaves, upsertLeave, getEmployees, newId, type Leave } from "@/lib/store";

export const Route = createFileRoute("/_admin/leaves")({ component: LeavesPage });

type LeaveWithName = Leave & { emp_name: string };

function LeavesPage() {
  const [leaves, setLeaves] = useState<LeaveWithName[]>([]);
  const [editing, setEditing] = useState<Partial<Leave> | null>(null);
  const [employees, setEmployees] = useState<{ id: string; full_name: string }[]>([]);

  const reload = () => {
    const emps = getEmployees().filter((e) => e.active);
    const empMap = new Map(emps.map((e) => [e.id, e.full_name]));
    setEmployees(emps);
    setLeaves(
      getLeaves()
        .sort((a, b) => b.from_date.localeCompare(a.from_date))
        .map((l) => ({ ...l, emp_name: empMap.get(l.employee_id) ?? "Unknown" })),
    );
  };

  useEffect(() => {
    reload();
  }, []);

  const approve = (l: Leave) => {
    upsertLeave({ ...l, status: "approved" });
    reload();
    toast.success("Approved");
  };
  const reject = (l: Leave) => {
    upsertLeave({ ...l, status: "rejected" });
    reload();
    toast.success("Rejected");
  };

  const save = () => {
    if (!editing?.employee_id) {
      toast.error("Employee select karein");
      return;
    }
    upsertLeave({
      id: editing.id ?? newId(),
      employee_id: editing.employee_id!,
      type: editing.type ?? "casual",
      from_date: editing.from_date ?? new Date().toISOString().slice(0, 10),
      to_date: editing.to_date ?? new Date().toISOString().slice(0, 10),
      reason: editing.reason ?? "",
      status: editing.status ?? "approved",
    });
    toast.success("Saved");
    setEditing(null);
    reload();
  };

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Leaves</h1>
          <p className="text-sm text-muted-foreground">
            {leaves.filter((l) => l.status === "pending").length} pending
          </p>
        </div>
        <Button
          onClick={() =>
            setEditing({
              type: "casual",
              status: "approved",
              from_date: new Date().toISOString().slice(0, 10),
              to_date: new Date().toISOString().slice(0, 10),
            })
          }
        >
          <Plus className="size-4 mr-1" /> Add Leave
        </Button>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>From</TableHead>
              <TableHead>To</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leaves.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="font-medium">{l.emp_name}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="capitalize">
                    {l.type}
                  </Badge>
                </TableCell>
                <TableCell>{l.from_date}</TableCell>
                <TableCell>{l.to_date}</TableCell>
                <TableCell className="max-w-[200px] truncate">{l.reason || "—"}</TableCell>
                <TableCell>
                  <Badge
                    variant={
                      l.status === "approved"
                        ? "default"
                        : l.status === "rejected"
                          ? "destructive"
                          : "secondary"
                    }
                    className="capitalize"
                  >
                    {l.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right space-x-1">
                  {l.status === "pending" && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => approve(l)}>
                        <Check className="size-4 text-green-600" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => reject(l)}>
                        <X className="size-4 text-red-600" />
                      </Button>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {leaves.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  Koi leave record nahi.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Leave</DialogTitle>
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
                <Label>Type</Label>
                <Select
                  value={editing.type ?? "casual"}
                  onValueChange={(v) => setEditing({ ...editing, type: v as Leave["type"] })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="casual">Casual</SelectItem>
                    <SelectItem value="sick">Sick</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="unpaid">Unpaid</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>From</Label>
                  <Input
                    type="date"
                    value={editing.from_date ?? ""}
                    onChange={(e) => setEditing({ ...editing, from_date: e.target.value })}
                  />
                </div>
                <div>
                  <Label>To</Label>
                  <Input
                    type="date"
                    value={editing.to_date ?? ""}
                    onChange={(e) => setEditing({ ...editing, to_date: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <Label>Reason</Label>
                <Input
                  value={editing.reason ?? ""}
                  onChange={(e) => setEditing({ ...editing, reason: e.target.value })}
                />
              </div>
              <div>
                <Label>Status</Label>
                <Select
                  value={editing.status ?? "approved"}
                  onValueChange={(v) => setEditing({ ...editing, status: v as Leave["status"] })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={save}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
