import { useEffect, useState } from "react";
import { Check, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { API } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { StatusResponse } from "@/types";

interface Props {
  status: StatusResponse | null;
  onSaved: () => void;
}

const PLANS = [
  {
    id: "starter",
    name: "Starter",
    desc: "Ideal para um único canal de cortes com fluxo local.",
    features: ["Extração com Gemini + Whisper", "7 formatos verticais 9:16", "Censura local +18"],
  },
  {
    id: "pro",
    name: "Pro",
    desc: "Para criadores com lives longas (8h+) e rotina diária.",
    features: ["40+ cortes por live longa", "Brand Kit completo e B-Roll", "Agendamento automático YouTube"],
  },
  {
    id: "agency",
    name: "Agency",
    desc: "Operação multi-canal e monitoramento contínuo por RSS.",
    features: ["Monitor RSS multi-fonte", "Compilações longas 16:9", "Presets dedicados por projeto"],
  },
];

const INPUT_CLS =
  "w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-[13px] text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none";

export function WorkspaceView({ status, onSaved }: Props) {
  const [owner, setOwner] = useState("");
  const [tagline, setTagline] = useState("");
  const [channelName, setChannelName] = useState("");
  const [handle, setHandle] = useState("");
  const [plan, setPlan] = useState("pro");
  const [licenseKey, setLicenseKey] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!status) return;
    setOwner(status.workspace?.owner_name || "");
    setTagline(status.workspace?.brand_tagline || "");
    setChannelName(status.channel?.name || "");
    setHandle(status.channel?.handle || "");
    setPlan((status.workspace?.plan || "pro").toLowerCase());
    setLicenseKey(status.workspace?.license_key || "");
  }, [status]);

  const handleSave = async (nextPlan = plan) => {
    setSaving(true);
    try {
      await API.saveConfig({
        workspace: {
          owner_name: owner.trim(),
          brand_tagline: tagline.trim(),
          plan: nextPlan,
          license_key: licenseKey.trim(),
        },
        channel: {
          name: channelName.trim(),
          handle: handle.trim(),
        },
      });
      setPlan(nextPlan);
      toast.success("Perfil do workspace salvo.");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar workspace");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-zinc-800/80 bg-[#121216] p-5">
        <h2 className="text-sm font-semibold text-zinc-100">Perfil do estúdio</h2>
        <p className="mb-4 text-xs text-zinc-500">
          Identidade exibida na barra lateral e aplicada como padrão no workspace local.
        </p>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Responsável / Estúdio</label>
            <input
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              placeholder="Ex.: ClipsReal Studio"
              className={INPUT_CLS}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Subtítulo do workspace</label>
            <input
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              placeholder="Ex.: Canal EN · Shorts & Lives"
              className={INPUT_CLS}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Nome do canal</label>
            <input
              value={channelName}
              onChange={(e) => setChannelName(e.target.value)}
              placeholder="Ex.: GTA VI"
              className={INPUT_CLS}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Handle (@)</label>
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="@BabyDragonOFC"
              className={INPUT_CLS}
            />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs font-medium text-zinc-400">
              Identificador local (opcional)
            </label>
            <input
              value={licenseKey}
              onChange={(e) => setLicenseKey(e.target.value)}
              placeholder="Opcional — uso local ilimitado"
              className={INPUT_CLS}
            />
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <Button variant="primary" size="sm" disabled={saving} onClick={() => handleSave(plan)}>
            <Save className="h-3.5 w-3.5" />
            {saving ? "Salvando…" : "Salvar perfil"}
          </Button>
        </div>
      </section>

      <section>
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-zinc-100">Perfil operacional local</h2>
          <p className="text-xs text-zinc-500">
            Execução 100% local na sua máquina — alterne o perfil de organização quando quiser.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {PLANS.map((p) => {
            const active = plan === p.id;
            return (
              <div
                key={p.id}
                className={cn(
                  "flex flex-col rounded-xl border p-5 transition-colors",
                  active
                    ? "border-zinc-400 bg-zinc-900/80"
                    : "border-zinc-800/80 bg-[#121216] hover:border-zinc-700",
                )}
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-zinc-100">{p.name}</h3>
                  {active && (
                    <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-zinc-950">
                      Ativo
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-xs text-zinc-400">{p.desc}</p>
                <ul className="mt-4 flex-1 space-y-2">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-xs text-zinc-300">
                      <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  className="mt-5 w-full"
                  size="sm"
                  variant={active ? "subtle" : "default"}
                  disabled={saving || active}
                  onClick={() => handleSave(p.id)}
                >
                  {active ? "Perfil selecionado" : `Selecionar ${p.name}`}
                </Button>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
