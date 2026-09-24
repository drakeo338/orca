import { Copy, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { translate } from '@/i18n/i18n'
import { basename } from '@/lib/path'
import { notebookVenvParent } from '../../../../shared/notebook-venv-location'
import {
  cancelPendingStart,
  createVirtualEnvironment,
  installIpykernel
} from './ipynb-kernel-session'
import { ipykernelInstallCommand, venvSetupCommand } from './ipynb-kernel-setup-commands'
import type { useNotebookKernelState } from './ipynb-kernel-store'

type KernelState = ReturnType<typeof useNotebookKernelState>

function dialogText(kernel: KernelState, offerVenv: boolean, folder: string) {
  const env = kernel.environment?.name ?? ''
  if (kernel.status === 'installing') {
    return {
      title: translate(
        'auto.components.editor.IpynbViewer.installingTitle',
        'Installing ipykernel…'
      ),
      description: translate(
        'auto.components.editor.IpynbViewer.installingDescription',
        "Installing ipykernel into '{{env}}' with pip. This can take a minute.",
        { env }
      )
    }
  }
  if (kernel.status === 'creating-venv') {
    return {
      title: translate(
        'auto.components.editor.IpynbViewer.creatingVenvTitle',
        'Creating virtual environment…'
      ),
      description: translate(
        'auto.components.editor.IpynbViewer.creatingVenvDescription',
        'Creating .venv in {{folder}} and installing ipykernel into it. This can take a minute.',
        { folder }
      )
    }
  }
  if (offerVenv) {
    return {
      title: translate(
        'auto.components.editor.IpynbViewer.createVenvTitle',
        'Create a virtual environment?'
      ),
      description: translate(
        'auto.components.editor.IpynbViewer.externallyManaged',
        "Running cells requires the ipykernel package, but '{{env}}' is managed by its installer and does not accept pip installs. Orca can create a .venv in {{folder}} with ipykernel instead.",
        { env, folder }
      )
    }
  }
  return {
    title: translate(
      'auto.components.editor.IpynbViewer.missingIpykernelTitle',
      'Install ipykernel?'
    ),
    description: translate(
      'auto.components.editor.IpynbViewer.missingIpykernel',
      "Running cells with '{{env}}' requires the ipykernel package.",
      { env }
    )
  }
}

function primaryLabel({ status, setupError }: KernelState, offerVenv: boolean): string {
  if (status === 'installing') {
    return translate('auto.components.editor.IpynbViewer.installingButton', 'Installing…')
  }
  if (status === 'creating-venv') {
    return translate('auto.components.editor.IpynbViewer.creatingButton', 'Creating…')
  }
  if (offerVenv) {
    return translate('auto.components.editor.IpynbViewer.createVenv', 'Create .venv')
  }
  return setupError
    ? translate('auto.components.editor.IpynbViewer.tryAgain', 'Try again')
    : translate('auto.components.editor.IpynbViewer.install', 'Install')
}

/** Gets ipykernel into the notebook's Python: pip install, or a new .venv when pip is locked out. */
export function IpynbKernelSetupDialog({
  filePath,
  rootPath,
  kernel,
  open,
  onChooseAnother
}: {
  filePath: string
  rootPath: string | null
  kernel: KernelState
  open: boolean
  onChooseAnother: () => void
}): React.JSX.Element {
  const { environment, status, setupError } = kernel
  const working = status === 'installing' || status === 'creating-venv'
  const offerVenv = kernel.externallyManaged || status === 'creating-venv'
  const venvParent = notebookVenvParent(filePath, rootPath)
  const { title, description } = dialogText(kernel, offerVenv, basename(venvParent))
  const command = !environment
    ? ''
    : offerVenv
      ? venvSetupCommand(environment.path, venvParent)
      : ipykernelInstallCommand(environment.path)
  const runPrimary = (): void => {
    if (!environment) {
      return
    }
    void (offerVenv
      ? createVirtualEnvironment(filePath, rootPath, environment)
      : installIpykernel(filePath))
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !working) {
          cancelPendingStart(filePath)
        }
      }}
    >
      <DialogContent className="max-w-lg sm:max-w-lg" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {setupError ? (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-destructive">
              {translate(
                'auto.components.editor.IpynbViewer.setupFailed',
                'That did not work. Output from Python:'
              )}
            </p>
            <pre className="scrollbar-sleek max-h-40 overflow-auto rounded-md border border-border bg-muted/50 px-3 py-2 font-mono text-xs break-all whitespace-pre-wrap text-foreground">
              {setupError}
            </pre>
          </div>
        ) : null}
        {command ? (
          <div className="flex items-start gap-2 rounded-md border border-border bg-muted/50 py-1.5 pr-1.5 pl-3">
            <code className="min-w-0 flex-1 py-0.5 font-mono text-xs break-all text-foreground select-all">
              {command}
            </code>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={translate(
                'auto.components.editor.IpynbViewer.copyCommand',
                'Copy command'
              )}
              onClick={() =>
                void window.api.ui
                  .writeClipboardText(command)
                  .then(() =>
                    toast.success(
                      translate(
                        'auto.components.editor.IpynbViewer.commandCopied',
                        'Command copied'
                      )
                    )
                  )
              }
            >
              <Copy />
            </Button>
          </div>
        ) : null}
        <DialogFooter className="sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={working}
            onClick={onChooseAnother}
          >
            {translate('auto.components.editor.IpynbViewer.chooseAnother', 'Use another Python…')}
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={working}
              onClick={() => cancelPendingStart(filePath)}
            >
              {translate('auto.components.editor.IpynbViewer.7f0d7077c6', 'Cancel')}
            </Button>
            <Button type="button" size="sm" autoFocus disabled={working} onClick={runPrimary}>
              {working ? <Loader2 className="animate-spin" /> : null}
              {primaryLabel(kernel, offerVenv)}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
