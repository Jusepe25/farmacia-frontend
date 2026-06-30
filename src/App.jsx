import { useState, useEffect, useCallback } from "react";


const BASE_URL = "http://localhost:4002";
const TOKEN = "test_api_key_123";


async function callProvider(path, { method = "GET", body } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  return { status: res.status, data };
}

const FIELDS = [
  { key: "referenciaDespacho", label: "Referencia de despacho", placeholder: "REF-DSP-0001", type: "text" },
  { key: "farmacia", label: "Farmacia (sucursal)", placeholder: "Sucursal Centro", type: "text" },
  { key: "medicamento", label: "Medicamento", placeholder: "Amoxicilina 500mg", type: "text" },
  { key: "dosis", label: "Dosis", placeholder: "1 cada 8h por 7 días", type: "text" },
  { key: "cantidad", label: "Cantidad", placeholder: "21", type: "number" },
];

export default function SimuladorFarmaciaApi() {
  const [form, setForm] = useState({
    referenciaDespacho: "",
    farmacia: "",
    medicamento: "",
    dosis: "",
    cantidad: "",
  });
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null); // { aceptada, referencia, motivo }
  const [reqError, setReqError] = useState(null);
  const [health, setHealth] = useState({ state: "idle" }); // idle | checking | ok | down
  const [lastChecked, setLastChecked] = useState(null);

  const checkHealth = useCallback(async () => {
    setHealth({ state: "checking" });
    try {
      const { status, data } = await callProvider("/health");
      if (status === 200 && data?.status === "ok") setHealth({ state: "ok" });
      else setHealth({ state: "down" });
    } catch {
      setHealth({ state: "down" });
    }
    setLastChecked(new Date());
  }, []);

  useEffect(() => {
    checkHealth();
  }, [checkHealth]);

  const update = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const canSend =
    form.referenciaDespacho.trim() &&
    form.farmacia.trim() &&
    form.medicamento.trim() &&
    form.dosis.trim() &&
    String(form.cantidad).trim() &&
    Number(form.cantidad) > 0;

  async function submit() {
    setReqError(null);
    setResult(null);
    setSending(true);
    try {
      const payload = { ...form, cantidad: Number(form.cantidad) };
      const { status, data } = await callProvider(
        "/api/v1/farmacia/recepcionar-receta",
        { method: "POST", body: payload }
      );
      if (status === 200) setResult(data);
      else setReqError(`El proveedor respondió ${status}. Revisa el payload o el token.`);
    } catch (e) {
      setReqError(
        "No se pudo contactar el proveedor en " + BASE_URL +
        ". Verifica que la farmacia-api esté levantada."
      );
    } finally {
      setSending(false);
    }
  }

  function reset() {
    setResult(null);
    setReqError(null);
  }

  const healthMeta = {
    idle: { dot: "bg-slate-300", text: "Sin verificar", ring: "ring-slate-200" },
    checking: { dot: "bg-amber-400 animate-pulse", text: "Verificando…", ring: "ring-amber-200" },
    ok: { dot: "bg-emerald-500", text: "Operativa", ring: "ring-emerald-200" },
    down: { dot: "bg-rose-500", text: "No responde", ring: "ring-rose-200" },
  }[health.state];

  return (
    <div className="min-h-screen bg-[#0d1b2a] text-slate-100 font-sans antialiased">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');
        .font-sans { font-family: 'IBM Plex Sans', system-ui, sans-serif; }
        .font-mono { font-family: 'IBM Plex Mono', monospace; }
      `}</style>

      <div className="max-w-5xl mx-auto px-5 py-8 sm:py-12">
        {/* Etiqueta de boundary — deja claro que NO es el SPA */}
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-medium text-amber-200">
          <span className="font-mono">⚠ Banco de pruebas</span>
          <span className="text-amber-200/70">Proveedor externo · fuera del boundary del SPA</span>
        </div>

        <header className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Farmacia API
            </h1>
            <p className="mt-1 text-slate-400 max-w-xl text-sm leading-relaxed">
              Simulador del proveedor externo de despacho de recetas. Sirve para
              probar el contrato del Adaptador Farmacia antes de integrarlo.
            </p>
          </div>

          {/* Healthcheck */}
          <button
            onClick={checkHealth}
            className={`group flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 ring-1 ${healthMeta.ring} transition hover:bg-white/10`}
          >
            <span className={`h-2.5 w-2.5 rounded-full ${healthMeta.dot}`} />
            <div className="text-left">
              <div className="text-sm font-semibold leading-none">{healthMeta.text}</div>
              <div className="mt-1 text-[11px] text-slate-400 font-mono">
                GET /health
                {lastChecked && health.state !== "checking" &&
                  ` · ${lastChecked.toLocaleTimeString()}`}
              </div>
            </div>
          </button>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          {/* Formulario */}
          <section className="rounded-2xl border border-white/10 bg-[#13263a] p-6">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Enviar receta</h2>
              <span className="font-mono text-[11px] text-slate-400">
                POST /api/v1/farmacia/recepcionar-receta
              </span>
            </div>

            <div className="space-y-4">
              {FIELDS.map((f) => (
                <label key={f.key} className="block">
                  <span className="mb-1.5 block text-sm font-medium text-slate-300">
                    {f.label}
                  </span>
                  <input
                    type={f.type}
                    value={form[f.key]}
                    onChange={(e) => update(f.key, e.target.value)}
                    placeholder={f.placeholder}
                    min={f.type === "number" ? 1 : undefined}
                    className="w-full rounded-lg border border-white/10 bg-[#0d1b2a] px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 outline-none transition focus:border-teal-400/60 focus:ring-2 focus:ring-teal-400/20"
                  />
                </label>
              ))}
            </div>

            <button
              onClick={submit}
              disabled={!canSend || sending}
              className="mt-6 w-full rounded-lg bg-teal-400 px-4 py-3 text-sm font-semibold text-[#0d1b2a] transition hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {sending ? "Enviando a la farmacia…" : "Enviar receta"}
            </button>
            {!canSend && (
              <p className="mt-2 text-center text-xs text-slate-500">
                Completa todos los campos. La cantidad debe ser mayor a 0.
              </p>
            )}
          </section>

          {/* Resultado */}
          <section className="rounded-2xl border border-white/10 bg-[#13263a] p-6 flex flex-col">
            <h2 className="mb-5 text-lg font-semibold">Respuesta del despacho</h2>

            {!result && !reqError && (
              <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-white/10 py-12 text-center">
                <span className="font-mono text-3xl text-slate-600">{"{ }"}</span>
                <p className="mt-3 text-sm text-slate-500 max-w-[14rem]">
                  Envía una receta para ver si la sucursal la acepta o la rechaza por stock.
                </p>
              </div>
            )}

            {reqError && (
              <div className="flex-1 rounded-xl border border-rose-500/30 bg-rose-500/10 p-5">
                <div className="flex items-center gap-2 text-rose-300">
                  <span className="h-2 w-2 rounded-full bg-rose-500" />
                  <span className="text-sm font-semibold">Fallo de conexión</span>
                </div>
                <p className="mt-2 text-sm text-rose-200/80">{reqError}</p>
              </div>
            )}

            {result && (
              <div className="flex-1">
                <div
                  className={`rounded-xl border p-5 ${
                    result.aceptada
                      ? "border-emerald-500/30 bg-emerald-500/10"
                      : "border-amber-500/30 bg-amber-500/10"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${
                        result.aceptada ? "bg-emerald-500" : "bg-amber-500"
                      }`}
                    />
                    <span
                      className={`text-base font-bold ${
                        result.aceptada ? "text-emerald-300" : "text-amber-300"
                      }`}
                    >
                      {result.aceptada ? "Receta aceptada" : "Receta rechazada"}
                    </span>
                  </div>

                  <dl className="mt-4 space-y-2.5 text-sm">
                    {result.aceptada ? (
                      <div className="flex justify-between gap-4">
                        <dt className="text-slate-400">Referencia</dt>
                        <dd className="font-mono text-emerald-200">{result.referencia}</dd>
                      </div>
                    ) : (
                      <div className="flex justify-between gap-4">
                        <dt className="text-slate-400">Motivo</dt>
                        <dd className="text-right text-amber-200">{result.motivo}</dd>
                      </div>
                    )}
                  </dl>
                </div>

                <details className="mt-4 group">
                  <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-200">
                    Ver respuesta cruda
                  </summary>
                  <pre className="mt-2 overflow-x-auto rounded-lg bg-[#0d1b2a] p-3 font-mono text-[11px] text-slate-300">
{JSON.stringify(result, null, 2)}
                  </pre>
                </details>

                <button
                  onClick={reset}
                  className="mt-4 w-full rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/5"
                >
                  Limpiar respuesta
                </button>
              </div>
            )}
          </section>
        </div>

        <footer className="mt-8 text-center text-xs text-slate-600">
          Este simulador toca el proveedor directamente solo por ser un banco de
          pruebas. En producción, únicamente el Adaptador Farmacia (SVC-PRE-009)
          debe invocarlo.
        </footer>
      </div>
    </div>
  );
}
