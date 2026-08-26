import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { getEmployees, getTempos, useCloudSync, type Employee, type Tempo } from "@/lib/store";

type Assignment = { id: string; employee_id: string; tempo_id: string; date: string; role: string };
const STORE_KEY = "tsa_assignments";

function getAssignments(): Assignment[] {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]");
  } catch {
    return [];
  }
}
function saveAssignments(a: Assignment[]) {
  localStorage.setItem(STORE_KEY, JSON.stringify(a));
}

export const Route = createFileRoute("/_admin/assignments")({ component: AssignmentsPage });

function AssignmentsPage() {
  const syncVersion = useCloudSync();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [tempos, setTempos] = useState<Tempo[]>([]);
  const [empId, setEmpId] = useState("");
  const [tempoId, setTempoId] = useState("");
  const [role, setRole] = useState("Driver");

  const reload = useCallback(() => {
    setEmployees(getEmployees().filter((e) => e.active));
    setTempos(getTempos().filter((t) => t.active));
    setAssignments(getAssignments().filter((a) => a.date === date));
  }, [date]);

  useEffect(() => {
    reload();
  }, [reload, syncVersion]);

  const add = () => {
    if (!empId || !tempoId) {
      toast.error("Employee aur tempo select karein");
      return;
    }
    const all = getAssignments();
    const exists = all.find((a) => a.employee_id === empId && a.date === date);
    if (exists) {
      toast.error("Employee already assigned today");
      return;
    }
    const id = crypto.randomUUID();
    saveAssignments([...all, { id, employee_id: empId, tempo_id: tempoId, date, role }]);
    setEmpId("");
    setTempoId("");
    reload();
    toast.success("Assigned!");
  };

  const remove = (id: string) => {
    saveAssignments(getAssignments().filter((a) => a.id !== id));
    reload();
  };

  const empMap = new Map(employees.map((e) => [e.id, e.full_name]));
  const tempoMap = new Map(tempos.map((t) => [t.id, t.vehicle_number]));

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-end flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Tempo Assignments</h1>
          <p className="text-sm text-muted-foreground">Daily employee ↔ tempo allocation</p>
        </div>
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-44"
        />
      </div>

      <Card className="p-4 grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
        <div>
          <label className="text-xs text-muted-foreground">Employee</label>
          <Select value={empId} onValueChange={setEmpId}>
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
          <label className="text-xs text-muted-foreground">Tempo</label>
          <Select value={tempoId} onValueChange={setTempoId}>
            <SelectTrigger>
              <SelectValue placeholder="Select tempo" />
            </SelectTrigger>
            <SelectContent>
              {tempos.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.vehicle_number}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Role</label>
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Driver">Driver</SelectItem>
              <SelectItem value="Loader">Loader</SelectItem>
              <SelectItem value="Helper">Helper</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={add}>Assign</Button>
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Tempo</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {assignments.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="font-medium">
                  {empMap.get(a.employee_id) ?? a.employee_id}
                </TableCell>
                <TableCell className="font-mono">
                  {tempoMap.get(a.tempo_id) ?? a.tempo_id}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{a.role}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => remove(a.id)}>
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {assignments.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                  Is din ke liye koi assignment nahi.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
