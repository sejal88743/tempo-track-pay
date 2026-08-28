// Compatibility client for the existing store. Its API mirrors only the small
// Supabase surface the store uses, while all requests now go to our own
// same-origin PostgreSQL API.
type CloudResult = { data: any; error: { message: string } | null };
type Filter = { column: string; value: unknown };
type CloudChange = {
  eventType: string;
  new: Record<string, unknown> | null;
  old: Record<string, unknown> | null;
};

class CloudQuery implements PromiseLike<CloudResult> {
  private action: "select" | "upsert" | "delete" = "select";
  private wantsResult = false;
  private payload: unknown;
  private filters: Filter[] = [];
  private maxRows: number | undefined;

  constructor(private readonly collection: string) {}

  select(_columns?: string) {
    this.wantsResult = true;
    return this;
  }

  order(_column?: string, _options?: unknown) {
    return this;
  }

  limit(value: number) {
    this.maxRows = value;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ column, value });
    return this;
  }

  maybeSingle() {
    this.wantsResult = true;
    return this;
  }

  upsert(payload: unknown, _options?: unknown) {
    this.action = "upsert";
    this.payload = payload;
    return this;
  }

  delete() {
    this.action = "delete";
    return this;
  }

  then<TResult1 = CloudResult, TResult2 = never>(
    onfulfilled?: ((value: CloudResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled ?? undefined, onrejected ?? undefined);
  }

  private async execute(): Promise<CloudResult> {
    try {
      if (this.action === "select") {
        const response = await fetch("/api/sync", { credentials: "include" });
        const body = (await response.json()) as Record<string, unknown> & { error?: string };
        if (!response.ok) return { data: null, error: { message: body.error ?? "Sync read failed" } };

        let data: any = body[this.collection] ?? [];
        if (this.collection === "settings") {
          data = [{ key: "app_settings", value: body.settings ?? {} }];
        }
        if (Array.isArray(data)) {
          for (const filter of this.filters) {
            data = data.filter((row: Record<string, unknown>) => {
              return (
                row &&
                typeof row === "object" &&
                (row as Record<string, unknown>)[filter.column] === filter.value
              );
            });
          }
          if (this.maxRows !== undefined) data = data.slice(0, this.maxRows);
        }
        const isSingle = this.wantsResult && this.filters.length > 0 && this.collection === "settings";
        return { data: isSingle ? (data as any[])[0] ?? null : data, error: null };
      }

      if (this.action === "delete") {
        const id = this.filters.find((filter) => filter.column === "id")?.value;
        const response = await fetch("/api/sync", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ operation: "delete", collection: this.collection, id }),
        });
        const body = (await response.json()) as { error?: string };
        return response.ok
          ? { data: null, error: null }
          : { data: null, error: { message: body.error ?? "Sync delete failed" } };
      }

      const payloads = Array.isArray(this.payload) ? this.payload : [this.payload];
      const results: unknown[] = [];
      for (const payload of payloads) {
        const response = await fetch("/api/sync", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ operation: "upsert", collection: this.collection, payload }),
        });
        const body = (await response.json()) as { data?: unknown; error?: string };
        if (!response.ok) return { data: null, error: { message: body.error ?? "Sync write failed" } };
        if (body.data) results.push(body.data);
      }
      return { data: this.wantsResult ? results[0] ?? null : null, error: null };
    } catch (error) {
      return {
        data: null,
        error: { message: error instanceof Error ? error.message : "Sync unavailable" },
      };
    }
  }
}

class CloudChannel {
  private readonly handlers: Array<{
    table: string;
    handler: (payload: CloudChange) => void;
  }> = [];
  private eventSource: EventSource | null = null;

  on(
    _event: string,
    filter: { table: string; [key: string]: unknown },
    handler: (payload: CloudChange) => void,
  ) {
    this.handlers.push({ table: filter.table, handler });
    return this;
  }

  subscribe(callback: (status: string) => void) {
    this.eventSource = new EventSource("/api/sync?stream=1");
    this.eventSource.onopen = () => callback("SUBSCRIBED");
    this.eventSource.onmessage = (message) => {
      try {
        const change = JSON.parse(message.data) as {
          table?: string;
          eventType?: string;
          row?: Record<string, unknown> | null;
        };
        if (!change.table) return;
          for (const item of this.handlers) {
          if (item.table === change.table) {
            item.handler({
              eventType: change.eventType ?? "UPDATE",
                new: change.eventType === "DELETE" ? null : (change.row ?? null),
                old: change.eventType === "DELETE" ? (change.row ?? null) : null,
            });
          }
        }
      } catch {
        // Ignore malformed heartbeat data.
      }
    };
    this.eventSource.onerror = () => callback("CHANNEL_ERROR");
    return this;
  }

  close() {
    this.eventSource?.close();
  }
}

class CloudClient {
  from(collection: string) {
    return new CloudQuery(collection);
  }

  channel(_name?: string) {
    return new CloudChannel();
  }
}

export const sb =
  typeof window === "undefined" ? (null as unknown as CloudClient) : new CloudClient();

// Stable per-device identifier (never leaves this browser).
const DEVICE_KEY = "tsa_device_id";
export function getDeviceId(): string {
  if (typeof window === "undefined") return "server";
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}