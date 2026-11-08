import { useAppStore } from '@/store'
import AddRepoDialog from '@/components/sidebar/AddRepoDialog'
import { readStartProjectStep } from './start-project-actions'

export default function StartAddRepoDialog(): React.JSX.Element {
  const step = useAppStore((state) => readStartProjectStep(state.modalData.initialStep))
  const host = useAppStore((state) =>
    typeof state.modalData.preferredHostId === 'string' ? state.modalData.preferredHostId : ''
  )
  return <AddRepoDialog key={`${step}:${host}`} initialStep={step} />
}
