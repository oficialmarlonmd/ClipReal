import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface ConfirmState {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
}

interface Props {
  state: ConfirmState | null;
  onClose: () => void;
}

export function ConfirmDialog({ state, onClose }: Props) {
  return (
    <Dialog open={Boolean(state?.open)} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md p-5">
        <DialogTitle>{state?.title || "Confirmar ação"}</DialogTitle>
        <DialogDescription className="mt-2 text-[13px] leading-relaxed text-zinc-400">
          {state?.message}
        </DialogDescription>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="default" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant={state?.danger ? "danger" : "primary"}
            size="sm"
            onClick={() => {
              state?.onConfirm();
              onClose();
            }}
          >
            {state?.confirmLabel || "Confirmar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
