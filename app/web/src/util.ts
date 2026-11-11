export const fmt = (sec?: number) => (sec == null || isNaN(sec) ? "" : `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`);
export const fmt1 = (sec: number) => `${fmt(sec)}.${Math.floor((sec % 1) * 10)}`;
export const fileUrl = (id: string, rel?: string) => (rel ? `/files/${id}/${rel.split("/").map(encodeURIComponent).join("/")}` : "");
export async function api<T = any>(url: string, method = "GET", body?: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j as T;
}
