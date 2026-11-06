/** While a fork cover sits over a group, Orca's retained surfaces for that group (terminals,
 *  chats, browser pages, which render in a layer above the group body) step back; they keep
 *  running, only hidden. */
export function HidePaneSurfaces({ groupId }: { groupId: string }): React.JSX.Element {
  const id = groupId.replaceAll('"', '')
  return <style>{`[data-retained-group="${id}"]{visibility:hidden}`}</style>
}
