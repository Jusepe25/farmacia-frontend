import { useState, useEffect, useCallback, useRef } from "react";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:4002";
const TOKEN    = import.meta.env.VITE_API_TOKEN || "test_api_key_123";
const POLL_MS  = 8000;

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw Object.assign(new Error(err.error || `HTTP ${res.status}`), { status: res.status });
  }
  return res.json();
}

/* ── helpers ──────────────────────────────────────────────────── */
const ESTADO_META = {
  ACEPTADA:             { label: "Aceptada",    color: "emerald", dot: "bg-emerald-400" },
  RECHAZADA_SIN_STOCK:  { label: "Sin stock",   color: "rose",    dot: "bg-rose-400" },
  RETIRADA_CONFIRMADA:  { label: "Retirada",    color: "sky",     dot: "bg-sky-400" },
  NO_RETIRADA_FARMACIA: { label: "No retirada", color: "amber",   dot: "bg-amber-400" },
};
const TODOS_ESTADOS = Object.keys(ESTADO_META);

function EstadoBadge({ estado }) {
  const m = ESTADO_META[estado] ?? { label: estado, color: "slate", dot: "bg-slate-400" };
  const cls = {
    emerald: "bg-emerald-400/15 text-emerald-300 ring-emerald-400/30",
    rose:    "bg-rose-400/15    text-rose-300    ring-rose-400/30",
    sky:     "bg-sky-400/15     text-sky-300     ring-sky-400/30",
    amber:   "bg-amber-400/15   text-amber-300   ring-amber-400/30",
    slate:   "bg-slate-400/15   text-slate-300   ring-slate-400/30",
  }[m.color] ?? "bg-slate-400/15 text-slate-300 ring-slate-400/30";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  );
}

function fmt(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString("es-PE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" });
}

/* agrupar recetas por idEncuentroClinico (o por id si no tiene) */
function agruparPorEncuentro(recetas) {
  const map = new Map();
  for (const r of recetas) {
    const key = r.idEncuentroClinico || r.id;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  return Array.from(map.entries()).map(([encId, items]) => ({
    encId,
    items,
    farmacia: items[0].farmacia,
    fechaRecepcion: items[0].fechaRecepcion,
    // cualquier vencimiento urgente
    urgente: items.some((r) => {
      const v = r.fechaLimiteRetiro ? new Date(r.fechaLimiteRetiro) : null;
      return v && Math.ceil((v - new Date()) / 86400000) <= 1;
    }),
  }));
}

/* ══════════════════════════════════════════════════════════════
   Modal de despacho por encuentro
══════════════════════════════════════════════════════════════ */
const MOTIVOS_RAPIDOS = [
  "Sin stock disponible",
  "Medicamento vencido",
  "Receta ilegible o incompleta",
  "Prescripción duplicada",
];

function EncuentroModal({ grupo, onClose, onRefresh, showToast }) {
  // estado local por receta: null=pendiente | 'dispensa' | 'rechaza' | 'done'
  const [acciones, setAcciones] = useState(() => {
    const m = {};
    for (const r of grupo.items) m[r.id] = { accion: null, motivo: "" };
    return m;
  });
  const [procesando, setProcesando] = useState({});

  const setAccion = (id, accion) =>
    setAcciones((p) => ({ ...p, [id]: { ...p[id], accion } }));
  const setMotivo = (id, motivo) =>
    setAcciones((p) => ({ ...p, [id]: { ...p[id], motivo } }));

  const pendientes = grupo.items.filter((r) => r.estado === "ACEPTADA");
  const seleccionados = pendientes.filter((r) => acciones[r.id]?.accion !== null);
  const todosDecididos = pendientes.every((r) => acciones[r.id]?.accion !== null);

  async function confirmar() {
    const tareas = pendientes.filter((r) => acciones[r.id]?.accion !== null);
    const nuevosProcesando = {};
    for (const r of tareas) nuevosProcesando[r.id] = true;
    setProcesando(nuevosProcesando);

    let ok = 0, fail = 0;
    for (const r of tareas) {
      const { accion, motivo } = acciones[r.id];
      try {
        if (accion === "dispensa") {
          await api(`/api/v2/farmacia/recetas/${r.id}/confirmar-retiro`, { method: "PATCH" });
        } else {
          await api(`/api/v2/farmacia/recetas/${r.id}/rechazar`, {
            method: "PATCH",
            body: { motivo: motivo || "Rechazada manualmente" },
          });
        }
        ok++;
      } catch (e) {
        fail++;
        showToast(`Error en ${r.medicamento}: ${e.message}`, "err");
      }
    }
    setProcesando({});
    if (ok > 0) showToast(`${ok} medicamento(s) procesado(s)`, "ok");
    onRefresh();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="flex w-full max-w-2xl flex-col rounded-2xl border border-white/10 bg-[#0f1f30] shadow-2xl max-h-[90vh]">
        {/* header */}
        <div className="flex items-start justify-between border-b border-white/[0.07] p-5">
          <div>
            <h2 className="font-bold text-slate-100 leading-tight">Prescripción del encuentro</h2>
            <p className="mt-0.5 font-mono text-xs text-slate-500">{grupo.encId}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-white/5 hover:text-slate-200">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* lista */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {grupo.items.map((r) => {
            const yaResuelta = r.estado !== "ACEPTADA";
            const ac = acciones[r.id];
            const isProcesando = procesando[r.id];

            return (
              <div key={r.id}
                className={`rounded-xl border p-4 transition-all
                  ${yaResuelta ? "border-white/[0.04] bg-white/[0.02] opacity-60"
                  : ac?.accion === "dispensa" ? "border-emerald-400/30 bg-emerald-400/[0.06]"
                  : ac?.accion === "rechaza"  ? "border-rose-400/30 bg-rose-400/[0.06]"
                  : "border-white/10 bg-white/[0.02]"}`}>

                {/* info del medicamento */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <span className="font-semibold text-slate-100">{r.medicamento}</span>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {r.dosis} · <span className="font-mono">{r.cantidad} uds.</span>
                    </p>
                    {r.motivoRechazo && (
                      <p className="mt-1 text-xs text-rose-400">{r.motivoRechazo}</p>
                    )}
                  </div>
                  {yaResuelta
                    ? <EstadoBadge estado={r.estado} />
                    : ac?.accion === "dispensa"
                      ? <span className="shrink-0 rounded-full bg-emerald-400/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300">✓ Aceptado</span>
                      : ac?.accion === "rechaza"
                        ? <span className="shrink-0 rounded-full bg-rose-400/20 px-2 py-0.5 text-[10px] font-bold text-rose-300">✕ Rechazado</span>
                        : null
                  }
                </div>

                {/* botones de acción — debajo, ancho completo */}
                {!yaResuelta && (
                  <div className="mt-3 flex gap-2">
                    <button
                      disabled={isProcesando}
                      onClick={() => setAccion(r.id, ac?.accion === "dispensa" ? null : "dispensa")}
                      className={`flex-1 rounded-lg py-2 text-xs font-bold transition
                        ${ac?.accion === "dispensa"
                          ? "bg-emerald-400 text-[#0d1b2a]"
                          : "border border-emerald-400/30 text-emerald-300 hover:bg-emerald-400/10"
                        } disabled:opacity-40`}>
                      ✓ Aceptar
                    </button>
                    <button
                      disabled={isProcesando}
                      onClick={() => {
                        const next = ac?.accion === "rechaza" ? null : "rechaza";
                        setAccion(r.id, next);
                        if (!next) setMotivo(r.id, "");
                      }}
                      className={`flex-1 rounded-lg py-2 text-xs font-bold transition
                        ${ac?.accion === "rechaza"
                          ? "bg-rose-500 text-white"
                          : "border border-rose-400/30 text-rose-300 hover:bg-rose-400/10"
                        } disabled:opacity-40`}>
                      ✕ Rechazar
                    </button>
                  </div>
                )}

                {/* motivo de rechazo — aparece al seleccionar Rechazar */}
                {!yaResuelta && ac?.accion === "rechaza" && (
                  <div className="mt-3 space-y-2">
                    <p className="text-[11px] font-medium text-slate-500">Motivo de rechazo:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {MOTIVOS_RAPIDOS.map((m) => (
                        <button key={m} onClick={() => setMotivo(r.id, m)}
                          className={`rounded-lg border px-2 py-1 text-[11px] transition
                            ${ac.motivo === m
                              ? "border-rose-400/50 bg-rose-400/15 text-rose-200"
                              : "border-white/10 text-slate-400 hover:border-white/20 hover:text-slate-200"}`}>
                          {m}
                        </button>
                      ))}
                    </div>
                    <input
                      value={ac.motivo}
                      onChange={(e) => setMotivo(r.id, e.target.value)}
                      placeholder="O escribe el motivo..."
                      className="w-full rounded-lg border border-white/10 bg-[#0d1b2a] px-3 py-1.5 text-xs text-slate-100 placeholder-slate-600 outline-none focus:border-rose-400/50"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* footer */}
        <div className="border-t border-white/[0.07] p-4">
          <div className="mb-3 flex items-center justify-between text-xs text-slate-500">
            <span>{seleccionados.length} de {pendientes.length} medicamento(s) seleccionado(s)</span>
            {!todosDecididos && (
              <button onClick={() => {
                const next = {};
                for (const r of pendientes) {
                  if (acciones[r.id]?.accion === null) next[r.id] = { accion: "dispensa", motivo: "" };
                }
                setAcciones((p) => ({ ...p, ...next }));
              }} className="text-teal-400 hover:text-teal-300 transition">
                Seleccionar todos →
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button onClick={onClose}
              className="flex-1 rounded-lg border border-white/10 py-2.5 text-sm text-slate-400 transition hover:bg-white/5">
              Cancelar
            </button>
            <button
              onClick={confirmar}
              disabled={seleccionados.length === 0 || Object.values(procesando).some(Boolean)}
              className="flex-1 rounded-lg bg-teal-400 py-2.5 text-sm font-bold text-[#0d1b2a] transition hover:bg-teal-300 disabled:opacity-40">
              {Object.values(procesando).some(Boolean) ? "Procesando…" : `Confirmar (${seleccionados.length})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Tarjeta individual (1 prescripción por encuentro) ────────── */
function SoloCard({ receta, onRefresh, showToast }) {
  const [accion, setAccion]     = useState(null);   // null | 'rechaza'
  const [motivo, setMotivo]     = useState("");
  const [procesando, setProcesando] = useState(false);

  const v      = receta.fechaLimiteRetiro ? new Date(receta.fechaLimiteRetiro) : null;
  const diasQ  = v ? Math.ceil((v - new Date()) / 86400000) : null;
  const urgente = diasQ !== null && diasQ <= 1;

  async function dispensar() {
    setProcesando(true);
    try {
      await api(`/api/v2/farmacia/recetas/${receta.id}/confirmar-retiro`, { method: "PATCH" });
      showToast("Medicamento dispensado", "ok");
      onRefresh();
    } catch (e) {
      showToast(`Error: ${e.message}`, "err");
      setProcesando(false);
    }
  }

  async function rechazar() {
    setProcesando(true);
    try {
      await api(`/api/v2/farmacia/recetas/${receta.id}/rechazar`, {
        method: "PATCH",
        body: { motivo: motivo || "Rechazada manualmente" },
      });
      showToast("Receta rechazada", "ok");
      onRefresh();
    } catch (e) {
      showToast(`Error: ${e.message}`, "err");
      setProcesando(false);
    }
  }

  return (
    <div className={`flex flex-col gap-4 rounded-2xl border p-5 transition-all
      ${urgente ? "border-amber-400/40 bg-amber-400/[0.06]" : "border-white/10 bg-[#13263a]"}`}>

      {urgente && (
        <span className="self-start rounded-full bg-amber-400/20 px-2 py-0.5 text-[10px] font-bold text-amber-300 ring-1 ring-amber-400/30">
          VENCE HOY
        </span>
      )}

      {/* ícono + medicamento */}
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-400/10 text-teal-300">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-100 leading-tight">{receta.medicamento}</p>
          <p className="mt-0.5 text-xs text-slate-400">
            {receta.dosis} · <span className="font-mono">{receta.cantidad} uds.</span>
          </p>
        </div>
      </div>

      {/* footer info */}
      <div className="flex items-center justify-between border-t border-white/[0.06] pt-3 text-xs">
        <span className="text-slate-500">{receta.farmacia}</span>
        <span className={urgente ? "font-semibold text-amber-300" : "text-slate-500"}>
          Límite: {fmtDate(v)}
        </span>
      </div>

      {/* botones de acción */}
      <div className="flex gap-2">
        <button
          disabled={procesando || accion === "rechaza"}
          onClick={dispensar}
          className="flex-1 rounded-lg bg-emerald-400 py-2 text-xs font-bold text-[#0d1b2a] transition hover:bg-emerald-300 disabled:opacity-40">
          {procesando && accion !== "rechaza" ? "Procesando…" : "✓ Dispensar"}
        </button>
        <button
          disabled={procesando}
          onClick={() => { setAccion(accion === "rechaza" ? null : "rechaza"); setMotivo(""); }}
          className={`flex-1 rounded-lg py-2 text-xs font-bold transition
            ${accion === "rechaza"
              ? "bg-rose-500 text-white"
              : "border border-rose-400/30 text-rose-300 hover:bg-rose-400/10"
            } disabled:opacity-40`}>
          ✕ Rechazar
        </button>
      </div>

      {/* motivo — solo cuando se selecciona rechazar */}
      {accion === "rechaza" && (
        <div className="space-y-2 rounded-xl border border-rose-400/20 bg-rose-400/[0.04] p-3">
          <p className="text-[11px] font-medium text-slate-500">Motivo de rechazo:</p>
          <div className="flex flex-wrap gap-1.5">
            {MOTIVOS_RAPIDOS.map((m) => (
              <button key={m} onClick={() => setMotivo(m)}
                className={`rounded-lg border px-2 py-1 text-[11px] transition
                  ${motivo === m
                    ? "border-rose-400/50 bg-rose-400/15 text-rose-200"
                    : "border-white/10 text-slate-400 hover:border-white/20 hover:text-slate-200"}`}>
                {m}
              </button>
            ))}
          </div>
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="O escribe el motivo..."
            className="w-full rounded-lg border border-white/10 bg-[#0d1b2a] px-3 py-1.5 text-xs text-slate-100 placeholder-slate-600 outline-none focus:border-rose-400/50"
          />
          <button
            disabled={procesando}
            onClick={rechazar}
            className="w-full rounded-lg bg-rose-500 py-2 text-xs font-bold text-white transition hover:bg-rose-400 disabled:opacity-40">
            {procesando ? "Procesando…" : "Confirmar rechazo"}
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Tarjeta de grupo en cola (2+ medicamentos del mismo encuentro) */
function GrupoCard({ grupo, onClick }) {
  const total   = grupo.items.length;
  const aceptadas = grupo.items.filter((r) => r.estado === "ACEPTADA").length;
  const vence   = grupo.items.reduce((min, r) => {
    const v = r.fechaLimiteRetiro ? new Date(r.fechaLimiteRetiro) : null;
    return v && (!min || v < min) ? v : min;
  }, null);
  const diasQ   = vence ? Math.ceil((vence - new Date()) / 86400000) : null;
  const urgente = diasQ !== null && diasQ <= 1;

  return (
    <button onClick={onClick}
      className={`group w-full text-left flex flex-col gap-4 rounded-2xl border p-5 transition-all
        ${urgente
          ? "border-amber-400/40 bg-amber-400/[0.06] hover:bg-amber-400/[0.1]"
          : "border-white/10 bg-[#13263a] hover:border-teal-400/40 hover:bg-[#152e47]"
        }`}>

      {urgente && (
        <span className="self-start rounded-full bg-amber-400/20 px-2 py-0.5 text-[10px] font-bold text-amber-300 ring-1 ring-amber-400/30">
          VENCE HOY
        </span>
      )}

      {/* ícono + título */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-400/10 text-teal-300">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-100 leading-tight">
            {total === 1 ? "1 medicamento" : `${total} medicamentos`}
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-slate-500 truncate">{grupo.encId}</p>
        </div>
        {/* flecha */}
        <svg className="h-4 w-4 shrink-0 text-slate-600 group-hover:text-teal-400 transition" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
      </div>

      {/* lista resumida de medicamentos */}
      <div className="space-y-1.5">
        {grupo.items.slice(0, 3).map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-2">
            <span className="text-xs text-slate-300 truncate">{r.medicamento}</span>
            <span className="shrink-0 font-mono text-[11px] text-slate-500">{r.cantidad} uds.</span>
          </div>
        ))}
        {grupo.items.length > 3 && (
          <p className="text-[11px] text-slate-600">+{grupo.items.length - 3} más…</p>
        )}
      </div>

      {/* footer de la card */}
      <div className="flex items-center justify-between border-t border-white/[0.06] pt-3 text-xs">
        <span className="text-slate-500">{grupo.farmacia}</span>
        <div className="flex items-center gap-3">
          {aceptadas < total && (
            <span className="text-rose-400">{total - aceptadas} con conflicto</span>
          )}
          <span className={urgente ? "font-semibold text-amber-300" : "text-slate-500"}>
            Límite: {fmtDate(vence)}
          </span>
        </div>
      </div>
    </button>
  );
}

/* ── Historial row ────────────────────────────────────────────── */
function HistRow({ receta }) {
  return (
    <tr className="border-b border-white/[0.05] transition-colors hover:bg-white/[0.025]">
      <td className="py-3 pl-5 pr-3">
        <p className="font-medium text-slate-200 leading-tight">{receta.medicamento}</p>
        <p className="text-xs text-slate-500">{receta.dosis}</p>
      </td>
      <td className="px-3 py-3 text-xs font-mono text-slate-400">{receta.cantidad}</td>
      <td className="px-3 py-3 text-xs text-slate-400">{receta.farmacia}</td>
      <td className="px-3 py-3"><EstadoBadge estado={receta.estado} /></td>
      <td className="px-3 py-3 text-xs text-slate-500">{fmt(receta.fechaRecepcion)}</td>
      <td className="px-3 py-3 text-xs font-mono text-slate-500 pr-5 truncate max-w-[12rem]">
        {receta.referenciaInterna || receta.motivoRechazo || "—"}
      </td>
    </tr>
  );
}

/* ── Stat chip ────────────────────────────────────────────────── */
function Stat({ label, value, color }) {
  const cls = {
    emerald: "text-emerald-300 bg-emerald-400/10 ring-emerald-400/20",
    rose:    "text-rose-300    bg-rose-400/10    ring-rose-400/20",
    sky:     "text-sky-300     bg-sky-400/10     ring-sky-400/20",
    amber:   "text-amber-300   bg-amber-400/10   ring-amber-400/20",
    teal:    "text-teal-300    bg-teal-400/10    ring-teal-400/20",
  }[color] ?? "";
  return (
    <div className={`flex flex-col items-center rounded-xl px-5 py-3 ring-1 ${cls}`}>
      <span className="text-2xl font-bold font-mono leading-none">{value}</span>
      <span className="mt-1 text-[11px] text-slate-400">{label}</span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   APP
═══════════════════════════════════════════════════════════════ */
export default function FarmaciaApp() {
  const [tab, setTab] = useState("cola");

  // ── health ─────────────────────────────────────────────────
  const [health, setHealth] = useState("idle");
  const checkHealth = useCallback(async () => {
    setHealth("checking");
    try {
      const d = await fetch(`${BASE_URL}/health`).then((r) => r.json());
      setHealth(d?.status === "ok" ? "ok" : "down");
    } catch { setHealth("down"); }
  }, []);
  useEffect(() => { checkHealth(); }, [checkHealth]);

  // ── cola ───────────────────────────────────────────────────
  const [cola,     setCola]     = useState([]);   // todas ACEPTADA
  const [colaLoad, setColaLoad] = useState(true);
  const [colaErr,  setColaErr]  = useState(null);
  const [stats,    setStats]    = useState({ total: 0, aceptadas: 0, rechazadas: 0, retiradas: 0, vencidas: 0 });
  const [modalGrupo, setModalGrupo] = useState(null);
  const [toastMsg,   setToastMsg]   = useState(null);
  const toastTimer = useRef(null);

  function showToast(msg, type = "ok") {
    clearTimeout(toastTimer.current);
    setToastMsg({ msg, type });
    toastTimer.current = setTimeout(() => setToastMsg(null), 3500);
  }

  const fetchCola = useCallback(async () => {
    try {
      const [rAcept, rRech, rRet, rVenc] = await Promise.all([
        api("/api/v2/farmacia/recetas?estado=ACEPTADA&limit=100"),
        api("/api/v2/farmacia/recetas?estado=RECHAZADA_SIN_STOCK&limit=1"),
        api("/api/v2/farmacia/recetas?estado=RETIRADA_CONFIRMADA&limit=1"),
        api("/api/v2/farmacia/recetas?estado=NO_RETIRADA_FARMACIA&limit=1"),
      ]);
      setCola(rAcept.recetas);
      setStats({
        total:     rAcept.total + rRech.total + rRet.total + rVenc.total,
        aceptadas: rAcept.total,
        rechazadas:rRech.total,
        retiradas: rRet.total,
        vencidas:  rVenc.total,
      });
      setColaErr(null);
    } catch (e) { setColaErr(e.message); }
    finally { setColaLoad(false); }
  }, []);

  useEffect(() => {
    fetchCola();
    const t = setInterval(fetchCola, POLL_MS);
    return () => clearInterval(t);
  }, [fetchCola]);

  const grupos = agruparPorEncuentro(cola);

  // ── historial ──────────────────────────────────────────────
  const [histEstado, setHistEstado] = useState("");
  const [histPage,   setHistPage]   = useState(1);
  const [histData,   setHistData]   = useState(null);
  const [histLoad,   setHistLoad]   = useState(false);

  const fetchHist = useCallback(async () => {
    setHistLoad(true);
    try {
      const qs = new URLSearchParams({ page: histPage, limit: 15, ...(histEstado && { estado: histEstado }) });
      setHistData(await api(`/api/v2/farmacia/recetas?${qs}`));
    } catch { setHistData(null); }
    finally { setHistLoad(false); }
  }, [histPage, histEstado]);

  useEffect(() => { if (tab === "historial") fetchHist(); }, [tab, fetchHist]);
  useEffect(() => { setHistPage(1); }, [histEstado]);

  // ── simulador ─────────────────────────────────────────────
  const [form, setForm] = useState({ referenciaDespacho: "", farmacia: "", medicamento: "", dosis: "", cantidad: "" });
  const [sending, setSending] = useState(false);
  const [simRes, setSimRes]   = useState(null);
  const [simErr, setSimErr]   = useState(null);

  const canSend = form.referenciaDespacho.trim() && form.farmacia.trim() &&
    form.medicamento.trim() && form.dosis.trim() && Number(form.cantidad) > 0;

  async function submitSim() {
    setSending(true); setSimRes(null); setSimErr(null);
    try {
      const d = await api("/api/v2/farmacia/recepcionar-receta", {
        method: "POST", body: { ...form, cantidad: Number(form.cantidad) },
      });
      setSimRes(d);
      fetchCola();
    } catch (e) { setSimErr(e.message); }
    finally { setSending(false); }
  }

  const hm = {
    idle:     { dot: "bg-slate-400",              text: "Sin verificar" },
    checking: { dot: "bg-amber-400 animate-pulse", text: "Verificando…" },
    ok:       { dot: "bg-emerald-400",             text: "Operativa" },
    down:     { dot: "bg-rose-500",                text: "No responde" },
  }[health];

  const totalPages = histData ? Math.ceil(histData.total / 15) : 1;

  return (
    <div className="min-h-screen bg-[#0d1b2a] text-slate-100 font-sans antialiased">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');
        body { font-family: 'IBM Plex Sans', system-ui, sans-serif; }
        .font-mono { font-family: 'IBM Plex Mono', monospace; }
      `}</style>

      {/* Toast */}
      {toastMsg && (
        <div className={`fixed bottom-5 right-5 z-50 flex items-center gap-3 rounded-xl border px-4 py-3 shadow-2xl text-sm font-medium
          ${toastMsg.type === "ok"
            ? "border-emerald-400/30 bg-[#0d2a1e] text-emerald-200"
            : "border-rose-400/30 bg-[#2a0d0d] text-rose-200"}`}>
          <span className={`h-2 w-2 rounded-full ${toastMsg.type === "ok" ? "bg-emerald-400" : "bg-rose-400"}`} />
          {toastMsg.msg}
        </div>
      )}

      {/* Modal */}
      {modalGrupo && (
        <EncuentroModal
          grupo={modalGrupo}
          onClose={() => setModalGrupo(null)}
          onRefresh={fetchCola}
          showToast={showToast}
        />
      )}

      <div className="max-w-6xl mx-auto px-5 py-8">
        {/* Header */}
        <header className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-400/15 text-teal-300">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15M14.25 3.104c.251.023.501.05.75.082M19.8 15l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.607L5 14.5m14.8.5l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21a48.25 48.25 0 01-8.135-.687c-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight leading-none">Farmacia</h1>
              <p className="mt-0.5 text-xs text-slate-500">Sistema de despacho de recetas</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-xs text-slate-500">
              <span className="h-1.5 w-1.5 rounded-full bg-teal-400 animate-pulse" />
              Auto-sync {POLL_MS / 1000}s
            </span>
            <button onClick={checkHealth}
              className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs transition hover:bg-white/10">
              <span className={`h-2 w-2 rounded-full ${hm.dot}`} />
              {hm.text}
            </button>
          </div>
        </header>

        {/* Stats */}
        <div className="mb-6 flex gap-3 overflow-x-auto pb-1">
          <Stat label="En cola"      value={stats.aceptadas}  color="emerald" />
          <Stat label="Rechazadas"   value={stats.rechazadas} color="rose"    />
          <Stat label="Retiradas"    value={stats.retiradas}  color="sky"     />
          <Stat label="No retiradas" value={stats.vencidas}   color="amber"   />
          <Stat label="Total"        value={stats.total}      color="teal"    />
        </div>

        {/* Tabs */}
        <div className="mb-6 flex gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
          {[
            { key: "cola",      label: "Cola de despacho" },
            { key: "historial", label: "Historial" },
            { key: "simular",   label: "Simulador" },
          ].map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex-1 rounded-lg py-2 text-sm font-medium transition
                ${tab === t.key ? "bg-teal-400 text-[#0d1b2a] shadow" : "text-slate-400 hover:text-slate-100"}`}>
              {t.label}
              {t.key === "cola" && grupos.length > 0 && (
                <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-bold
                  ${tab === "cola" ? "bg-[#0d1b2a]/30 text-[#0d1b2a]" : "bg-emerald-400/20 text-emerald-300"}`}>
                  {grupos.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── TAB: COLA ── */}
        {tab === "cola" && (
          <div>
            {colaLoad ? (
              <div className="flex items-center justify-center py-20 text-slate-500 gap-3">
                <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Cargando cola…
              </div>
            ) : colaErr ? (
              <div className="rounded-xl border border-rose-400/30 bg-rose-400/10 p-6 text-center text-sm text-rose-300">
                {colaErr}
              </div>
            ) : grupos.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 py-20 text-center">
                <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.04] text-slate-500">
                  <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-slate-400">Cola vacía</p>
                <p className="mt-1 text-xs text-slate-600">Las prescripciones aceptadas aparecerán aquí agrupadas por encuentro</p>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {grupos.map((g) =>
                  g.items.length === 1
                    ? <SoloCard key={g.encId} receta={g.items[0]} onRefresh={fetchCola} showToast={showToast} />
                    : <GrupoCard key={g.encId} grupo={g} onClick={() => setModalGrupo(g)} />
                )}
              </div>
            )}
          </div>
        )}

        {/* ── TAB: HISTORIAL ── */}
        {tab === "historial" && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setHistEstado("")}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition
                  ${histEstado === "" ? "bg-teal-400 text-[#0d1b2a]" : "border border-white/10 text-slate-400 hover:text-slate-100"}`}>
                Todos
              </button>
              {TODOS_ESTADOS.map((e) => (
                <button key={e} onClick={() => setHistEstado(e)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition
                    ${histEstado === e ? "bg-teal-400 text-[#0d1b2a]" : "border border-white/10 text-slate-400 hover:text-slate-100"}`}>
                  {ESTADO_META[e].label}
                </button>
              ))}
              <button onClick={fetchHist}
                className="ml-auto rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-100 transition">
                ↻ Actualizar
              </button>
            </div>
            <div className="overflow-hidden rounded-2xl border border-white/10">
              {histLoad ? (
                <div className="flex items-center justify-center py-16 text-slate-500 text-sm gap-3">
                  <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Cargando…
                </div>
              ) : !histData?.recetas?.length ? (
                <div className="py-16 text-center text-sm text-slate-500">Sin registros</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="border-b border-white/[0.06] bg-white/[0.02]">
                    <tr>
                      {["Medicamento / Dosis", "Cant.", "Farmacia", "Estado", "Recepción", "Referencia"].map((h) => (
                        <th key={h} className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 first:pl-5 last:pr-5">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {histData.recetas.map((r) => <HistRow key={r.id} receta={r} />)}
                  </tbody>
                </table>
              )}
            </div>
            {histData && totalPages > 1 && (
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>{histData.total} registros · pág. {histPage} / {totalPages}</span>
                <div className="flex gap-2">
                  <button disabled={histPage <= 1} onClick={() => setHistPage((p) => p - 1)}
                    className="rounded-lg border border-white/10 px-3 py-1.5 transition hover:bg-white/5 disabled:opacity-30">
                    ← Anterior
                  </button>
                  <button disabled={histPage >= totalPages} onClick={() => setHistPage((p) => p + 1)}
                    className="rounded-lg border border-white/10 px-3 py-1.5 transition hover:bg-white/5 disabled:opacity-30">
                    Siguiente →
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── TAB: SIMULADOR ── */}
        {tab === "simular" && (
          <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
            <section className="rounded-2xl border border-white/10 bg-[#13263a] p-6">
              <div className="mb-1 flex items-center justify-between">
                <h2 className="font-semibold">Enviar receta de prueba</h2>
                <span className="font-mono text-[10px] text-slate-500">POST /recepcionar-receta</span>
              </div>
              <p className="mb-5 text-xs text-slate-500">
                Simula una receta entrante. Usa <span className="font-mono text-rose-300">SIN-STOCK</span> para forzar rechazo.
              </p>
              <div className="space-y-3">
                {[
                  { key: "referenciaDespacho", label: "Referencia despacho", ph: "PRESC-abc123" },
                  { key: "farmacia",           label: "Farmacia",            ph: "Sucursal Centro" },
                  { key: "medicamento",        label: "Medicamento",         ph: "Amoxicilina 500mg" },
                  { key: "dosis",              label: "Dosis",               ph: "1 cada 8h por 7 días" },
                ].map((f) => (
                  <label key={f.key} className="block">
                    <span className="mb-1 block text-xs font-medium text-slate-400">{f.label}</span>
                    <input value={form[f.key]} onChange={(e) => setForm((x) => ({ ...x, [f.key]: e.target.value }))}
                      placeholder={f.ph}
                      className="w-full rounded-lg border border-white/10 bg-[#0d1b2a] px-3 py-2 text-sm text-slate-100 placeholder-slate-600 outline-none focus:border-teal-400/60 focus:ring-2 focus:ring-teal-400/20" />
                  </label>
                ))}
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-400">Cantidad</span>
                  <input type="number" min={1} max={200} value={form.cantidad}
                    onChange={(e) => setForm((x) => ({ ...x, cantidad: e.target.value }))}
                    placeholder="21"
                    className="w-full rounded-lg border border-white/10 bg-[#0d1b2a] px-3 py-2 text-sm text-slate-100 placeholder-slate-600 outline-none focus:border-teal-400/60 focus:ring-2 focus:ring-teal-400/20" />
                </label>
              </div>
              <button onClick={submitSim} disabled={!canSend || sending}
                className="mt-5 w-full rounded-lg bg-teal-400 py-2.5 text-sm font-bold text-[#0d1b2a] transition hover:bg-teal-300 disabled:opacity-40">
                {sending ? "Enviando…" : "Enviar receta"}
              </button>
            </section>

            <section className="rounded-2xl border border-white/10 bg-[#13263a] p-6 flex flex-col">
              <h2 className="mb-5 font-semibold">Respuesta</h2>
              {!simRes && !simErr && (
                <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-white/10 py-12 text-center">
                  <span className="font-mono text-3xl text-slate-700">{"{ }"}</span>
                  <p className="mt-3 text-xs text-slate-600 max-w-[14rem]">Envía una receta para ver la respuesta</p>
                </div>
              )}
              {simErr && (
                <div className="rounded-xl border border-rose-400/30 bg-rose-400/10 p-5 text-sm text-rose-300">{simErr}</div>
              )}
              {simRes && (
                <div className="flex-1 space-y-4">
                  <div className={`rounded-xl border p-5 ${simRes.aceptada ? "border-emerald-400/30 bg-emerald-400/10" : "border-rose-400/30 bg-rose-400/10"}`}>
                    <div className="flex items-center gap-2.5 mb-4">
                      <span className={`h-2.5 w-2.5 rounded-full ${simRes.aceptada ? "bg-emerald-400" : "bg-rose-400"}`} />
                      <span className={`font-bold ${simRes.aceptada ? "text-emerald-300" : "text-rose-300"}`}>
                        {simRes.aceptada ? "Receta aceptada — aparecerá en la cola" : "Rechazada por stock"}
                      </span>
                    </div>
                    <dl className="space-y-2 text-sm">
                      {simRes.aceptada
                        ? <div className="flex justify-between"><dt className="text-slate-500">Referencia</dt><dd className="font-mono text-emerald-200">{simRes.referencia}</dd></div>
                        : <div className="flex justify-between"><dt className="text-slate-500">Motivo</dt><dd className="text-rose-200 text-right">{simRes.motivo}</dd></div>
                      }
                    </dl>
                  </div>
                  <button onClick={() => setSimRes(null)}
                    className="w-full rounded-lg border border-white/10 py-2 text-xs text-slate-400 hover:bg-white/5 transition">
                    Limpiar
                  </button>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
