/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo, useRef } from "react";
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
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Pencil, Trash2, Plus, ScanFace, Upload, FileUp, Check, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import {
  getEmployees,
  upsertEmployee,
  deleteEmployee,
  newId,
  ALL_ROLES,
  useCloudSync,
  type Employee,
  type Role,
} from "@/lib/store";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { BiometricEnrollDialog } from "@/components/BiometricEnrollDialog";

export const Route = createFileRoute("/_admin/employees")({ component: EmployeesPage });

const empty = (): Partial<Employee> => ({
  active: true,
  biometric_enrolled: false,
  role: "Delivery Man",
  extra_roles: [],
  monthly_salary: 0,
  joining_date: "2026-05-01",
});

// ── Parse MDB binary in browser (mdb-reader uses ArrayBuffer) ──────────────
async function parseMdbEmployees(
  buffer: ArrayBuffer,
): Promise<{ name: string; active: boolean }[]> {
  const MdbReader = await import("mdb-reader");
  const Reader = (MdbReader as any).default ?? MdbReader;
  const db = new Reader(Buffer.from(buffer));
  const table = db.getTable("EmpMast");
  const rows = table.getData({ columns: ["Name", "Cardstatus"] });
  return rows
    .filter((r: any) => r.Name && String(r.Name).trim())
    .map((r: any) => ({
      name: String(r.Name).trim().replace(/\s+/g, " "),
      active:
        String(r.Cardstatus || "Active")
          .toLowerCase()
          .includes("not") === false,
    }));
}

function EmployeesPage() {
  const syncVersion = useCloudSync();
  const emps = useMemo(() => {
    void syncVersion;
    return getEmployees();
  }, [syncVersion]);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Partial<Employee> | null>(null);
  const [faceEmp, setFaceEmp] = useState<Employee | null>(null);
  const [deletingEmp, setDeletingEmp] = useState<Employee | null>(null);
  const [mdbParsing, setMdbParsing] = useState(false);
  const [mdbPreview, setMdbPreview] = useState<
    { name: string; active: boolean; skip: boolean }[] | null
  >(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filtered = emps.filter(
    (e) =>
      !search ||
      e.full_name.toLowerCase().includes(search.toLowerCase()) ||
      e.role.toLowerCase().includes(search.toLowerCase()),
  );

  const toggleExtraRole = (role: Role) => {
    if (!editing) return;
    const current = editing.extra_roles ?? [];
    if (role === editing.role) return;
    const updated = current.includes(role) ? current.filter((r) => r !== role) : [...current, role];
    setEditing({ ...editing, extra_roles: updated });
  };

  const save = () => {
    if (!editing?.full_name?.trim()) {
      toast.error("Naam enter karein");
      return;
    }
    if (!editing.role) {
      toast.error("Primary role select karein");
      return;
    }
    upsertEmployee({
      id: editing.id ?? newId(),
      full_name: editing.full_name.trim(),
      role: editing.role as Role,
      extra_roles: (editing.extra_roles ?? []).filter((r) => r !== editing.role),
      monthly_salary: Number(editing.monthly_salary ?? 0),
      joining_date: editing.joining_date ?? new Date().toISOString().slice(0, 10),
      mobile: editing.mobile ?? "",
      active: editing.active ?? true,
      biometric_enrolled: false,
      face_descriptor: editing.face_descriptor,
    });
    toast.success("Employee save ho gaya!");
    setEditing(null);
  };

  const confirmDelete = async (emp: Employee) => {
    try {
      deleteEmployee(emp.id);
      toast.success(`${emp.full_name} ko successfully remove/delete kar diya gaya.`);
      setDeletingEmp(null);
    } catch (err) {
      toast.error("Delete karne mein error aaya: " + (err as Error).message);
    }
  };

  // ── MDB Import ──────────────────────────────────────────────────────────────
  const handleMdbFile = async (file: File) => {
    setMdbParsing(true);
    try {
      const buffer = await file.arrayBuffer();
      const parsed = await parseMdbEmployees(buffer);
      const existingNames = new Set(getEmployees().map((e) => e.full_name.trim().toLowerCase()));
      const preview = parsed.map((p) => ({
        ...p,
        skip: existingNames.has(p.name.toLowerCase()),
      }));
      setMdbPreview(preview);
    } catch (e) {
      toast.error("MDB parse error: " + (e as Error).message);
    } finally {
      setMdbParsing(false);
    }
  };

  const confirmMdbImport = () => {
    if (!mdbPreview) return;
    const toImport = mdbPreview.filter((p) => !p.skip);
    let count = 0;
    toImport.forEach((p) => {
      upsertEmployee({
        id: newId(),
        full_name: p.name,
        role: "Delivery Man",
        extra_roles: [],
        monthly_salary: 0,
        joining_date: new Date().toISOString().slice(0, 10),
        mobile: "",
        active: p.active,
        biometric_enrolled: false,
      });
      count++;
    });
    toast.success(`✅ ${count} employees import ho gaye! Role & salary manually set karein.`);
    setMdbPreview(null);
  };

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Employees</h1>
          <p className="text-sm text-muted-foreground">
            {emps.filter((e) => e.active).length} active
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Input
            placeholder="Search naam ya role…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-48"
          />
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={mdbParsing}
          >
            <FileUp className="size-4 mr-1" />
            {mdbParsing ? "Parsing…" : "Import .mdb"}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".mdb,.accdb"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleMdbFile(f);
              e.target.value = "";
            }}
          />
          <Button onClick={() => setEditing(empty())}>
            <Plus className="size-4 mr-1" /> Add Employee
          </Button>
        </div>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead>Mobile</TableHead>
              <TableHead className="text-right">Salary (₹)</TableHead>
              <TableHead>Face</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="font-medium">{e.full_name}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant="secondary">{e.role}</Badge>
                    {(e.extra_roles ?? []).map((r) => (
                      <Badge key={r} variant="outline" className="text-xs">
                        {r}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>{e.mobile || "—"}</TableCell>
                <TableCell className="text-right">
                  ₹{Number(e.monthly_salary).toLocaleString("en-IN")}
                </TableCell>
                <TableCell>
                  {e.face_descriptor ? (
                    <span className="text-green-600 text-xs flex items-center gap-1">
                      <ScanFace className="size-3.5" /> Registered
                    </span>
                  ) : (
                    <span className="text-muted-foreground text-xs">Not set</span>
                  )}
                </TableCell>
                <TableCell>
                  {e.active ? <Badge>Active</Badge> : <Badge variant="destructive">Inactive</Badge>}
                </TableCell>
                <TableCell className="text-right space-x-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    title="Register Face"
                    onClick={() => setFaceEmp(e)}
                  >
                    <ScanFace className="size-4 text-primary" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditing({ ...e, extra_roles: e.extra_roles ?? [] })}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title="Delete Employee"
                    onClick={() => setDeletingEmp(e)}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  {emps.length === 0
                    ? "Koi employee nahi. Add Employee ya .mdb import karein."
                    : "No results."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {/* ── Edit / Add Dialog ─────────────────────────────────────────────── */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit Employee" : "New Employee"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
              <div>
                <Label>Full Name *</Label>
                <Input
                  value={editing.full_name ?? ""}
                  onChange={(e) => setEditing({ ...editing, full_name: e.target.value })}
                  placeholder="Employee ka naam"
                />
              </div>
              <div>
                <Label>Primary Role *</Label>
                <Select
                  value={editing.role ?? "Delivery Man"}
                  onValueChange={(v) => setEditing({ ...editing, role: v as Role })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ALL_ROLES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-2 block">Extra Roles (optional)</Label>
                <div className="grid grid-cols-2 gap-2">
                  {ALL_ROLES.filter((r) => r !== editing.role).map((r) => (
                    <label key={r} className="flex items-center gap-2 cursor-pointer text-sm">
                      <Checkbox
                        checked={(editing.extra_roles ?? []).includes(r)}
                        onCheckedChange={() => toggleExtraRole(r)}
                      />
                      {r}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <Label>Monthly Salary (₹)</Label>
                <Input
                  type="number"
                  value={editing.monthly_salary ?? 0}
                  onChange={(e) =>
                    setEditing({ ...editing, monthly_salary: Number(e.target.value) })
                  }
                />
              </div>
              <div>
                <Label>Mobile Number</Label>
                <Input
                  value={editing.mobile ?? ""}
                  onChange={(e) => setEditing({ ...editing, mobile: e.target.value })}
                  placeholder="9876543210"
                />
              </div>
              <div>
                <Label>Joining Date</Label>
                <Input
                  type="date"
                  value={editing.joining_date?.slice(0, 10) ?? ""}
                  onChange={(e) => setEditing({ ...editing, joining_date: e.target.value })}
                />
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  checked={editing.active ?? true}
                  onCheckedChange={(v) => setEditing({ ...editing, active: v })}
                />
                <Label>Active Employee</Label>
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

      {/* ── MDB Import Preview Dialog ────────────────────────────────────────── */}
      <Dialog open={!!mdbPreview} onOpenChange={(o) => !o && setMdbPreview(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="size-5" /> MDB Import Preview
            </DialogTitle>
          </DialogHeader>
          {mdbPreview && (
            <div className="space-y-3">
              <div className="flex gap-4 text-sm">
                <span className="text-green-600 font-semibold">
                  ✅ {mdbPreview.filter((p) => !p.skip).length} naye import honge
                </span>
                <span className="text-muted-foreground">
                  ⏭ {mdbPreview.filter((p) => p.skip).length} already exist (skip)
                </span>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-md p-2.5 text-xs text-amber-700 flex gap-2">
                <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
                Role aur salary import ke baad manually set karein. Default: "Delivery Man", ₹0
              </div>
              <div className="max-h-64 overflow-y-auto border rounded-md divide-y text-sm">
                {mdbPreview.map((p, i) => (
                  <div
                    key={i}
                    className={`flex items-center justify-between px-3 py-2 ${p.skip ? "opacity-40" : ""}`}
                  >
                    <span>{p.name}</span>
                    <div className="flex items-center gap-2">
                      {!p.active && (
                        <Badge variant="outline" className="text-xs">
                          Inactive
                        </Badge>
                      )}
                      {p.skip ? (
                        <span className="text-xs text-muted-foreground">Already exists</span>
                      ) : (
                        <Check className="size-3.5 text-green-600" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMdbPreview(null)}>
              Cancel
            </Button>
            <Button onClick={confirmMdbImport} disabled={!mdbPreview?.some((p) => !p.skip)}>
              <Upload className="size-4 mr-1" />
              Import Karein ({mdbPreview?.filter((p) => !p.skip).length ?? 0})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Face Enroll Dialog ───────────────────────────────────────────────── */}
      <BiometricEnrollDialog
        employee={faceEmp}
        open={!!faceEmp}
        onOpenChange={(o) => {
          if (!o) {
            setFaceEmp(null);
            reload();
          }
        }}
      />

      {/* ── Delete Confirmation Dialog ───────────────────────────────────────── */}
      <AlertDialog open={!!deletingEmp} onOpenChange={(open) => !open && setDeletingEmp(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Employee Delete Karein?</AlertDialogTitle>
            <AlertDialogDescription>
              Kya aap sach mein <strong>{deletingEmp?.full_name}</strong> ({deletingEmp?.role}) ko
              system se remove/delete karna chahte hain? Yeh employee table aur cloud database dono
              se turant delete ho jayega.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeletingEmp(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deletingEmp && confirmDelete(deletingEmp)}
            >
              Delete Karein
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
