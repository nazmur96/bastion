import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem
} from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  cloudMutationSchema,
  type CloudMutation,
  type CloudTarget
} from '../../../../shared/fork-cloud/cloud-target-contract'

export function CloudTargetForm({
  target,
  pending,
  onClose,
  onSave
}: {
  target: CloudTarget | null
  pending: boolean
  onClose: () => void
  onSave: (mutation: CloudMutation) => Promise<boolean>
}): React.JSX.Element {
  const [label, setLabel] = useState(target?.label ?? '')
  const [kind, setKind] = useState('real')
  const [provider, setProvider] = useState('aws')
  const [profileName, setProfile] = useState('')
  const [region, setRegion] = useState('')
  const [version, setVersion] = useState('')
  const [port, setPort] = useState('')
  const [invalid, setInvalid] = useState(false)
  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    const configuration =
      kind === 'real'
        ? { kind, provider: 'aws', profileName, region }
        : {
            kind,
            provider,
            emulator: 'floci',
            cliVersion: version,
            runtimeId: 'local',
            ...(port ? { requestedPort: Number(port) } : {})
          }
    const result = cloudMutationSchema.safeParse(
      target ? { kind: 'rename', id: target.id, label } : { kind: 'add', label, configuration }
    )
    setInvalid(!result.success)
    if (result.success && (await onSave(result.data))) {
      onClose()
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) {
          onClose()
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{target ? 'Rename target' : 'Add target'}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            void submit(event)
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="cloud-label">Target label</Label>
            <Input
              id="cloud-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              maxLength={80}
              required
              autoFocus
              aria-invalid={invalid}
            />
          </div>
          {!target && (
            <>
              <div className="space-y-2">
                <Label htmlFor="cloud-kind">Target kind</Label>
                <Select value={kind} onValueChange={setKind}>
                  <SelectTrigger id="cloud-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="real">Real AWS</SelectItem>
                    <SelectItem value="emulated">Emulated · Floci</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {kind === 'real' ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="cloud-profile">AWS profile name</Label>
                    <Input
                      id="cloud-profile"
                      value={profileName}
                      onChange={(event) => setProfile(event.target.value)}
                      required
                      maxLength={128}
                      aria-invalid={invalid}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cloud-region">Region</Label>
                    <Input
                      id="cloud-region"
                      value={region}
                      onChange={(event) => setRegion(event.target.value)}
                      placeholder="us-east-1"
                      required
                      maxLength={64}
                      aria-invalid={invalid}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="cloud-provider">Emulated provider</Label>
                    <Select value={provider} onValueChange={setProvider}>
                      <SelectTrigger id="cloud-provider">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {['aws', 'azure', 'gcp', 'oci'].map((value) => (
                          <SelectItem key={value} value={value}>
                            {value.toUpperCase()}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cloud-version">Floci CLI version</Label>
                    <Input
                      id="cloud-version"
                      value={version}
                      onChange={(event) => setVersion(event.target.value)}
                      placeholder="0.4.0"
                      required
                      maxLength={32}
                      aria-invalid={invalid}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cloud-port">Requested port (optional)</Label>
                    <Input
                      id="cloud-port"
                      type="number"
                      min={1024}
                      max={65535}
                      value={port}
                      onChange={(event) => setPort(event.target.value)}
                      aria-invalid={invalid}
                    />
                  </div>
                </>
              )}
              <p className="text-xs text-muted-foreground">
                Metadata only. No credentials are read or stored. Saving does not sign in, verify or
                start an emulator.
              </p>
            </>
          )}
          {invalid && (
            <p role="alert" className="text-sm text-destructive">
              Check the label and target metadata. Use a region identifier or a version such as
              0.4.0.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              Save target
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
