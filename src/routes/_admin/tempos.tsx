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
import { Switch } from "@/components/ui/switch";
import { Pencil, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import { getTempos, upsertTempo, saveTempos, newId, type Tempo } from "@/lib/store";

export const Route = createFileRoute("/_admin/tempos")({ component: TemposPage });

function TemposPage() {
  const [tempos, setTempos] = useState<Tempo[]>([]);
  const [editing, setEditing] = useState<Partial<Tempo> | null>(null);

  const reload = () => setTempos(getTempos());
  useEffect(() => {
    reload();
  }, []);

  const save = () => {
    if (!editing?.vehicle_number?.trim()) {
      toast.error("Vehicle number enter karein");
      return;
    }
    upsertTempo({
      id: editing.id ?? newId(),
      vehicle_number: editing.vehicle_number.trim(),
      active: editing.active ?? true,
    });
    toast.success("Saved");
    setEditing(null);
    reload();
  };

  const remove = (id: string) => {
    if (!confirm("Delete tempo?")) return;
    saveTempos(getTempos().filter((t) => t.id !== id));
    reload();
  };

  return (
    <div className="p-3 space-y-3">
      <div className="flex justify-between items-center flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Tempos</h1>
          <p className="text-sm text-muted-foreground">
            {tempos.filter((t) => t.active).length} active vehicles
          </p>
        </div>
        <Button onClick={() => setEditing({ active: true })}>
          <Plus className="size-4 mr-1" /> Add Tempo
        </Button>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Vehicle Number</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tempos.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-mono font-medium">{t.vehicle_number}</TableCell>
                <TableCell>
                  {t.active ? <Badge>Active</Badge> : <Badge variant="destructive">Inactive</Badge>}
                </TableCell>
                <TableCell className="text-right space-x-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(t.id)}>
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {tempos.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                  Koi tempo nahi. Add karo.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit Tempo" : "Add Tempo"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div>
                <Label>Vehicle Number</Label>
                <Input
                  value={editing.vehicle_number ?? ""}
                  onChange={(e) => setEditing({ ...editing, vehicle_number: e.target.value })}
                  placeholder="MH-12-AB-1234"
                />
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  checked={editing.active ?? true}
                  onCheckedChange={(v) => setEditing({ ...editing, active: v })}
                />
                <Label>Active</Label>
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
