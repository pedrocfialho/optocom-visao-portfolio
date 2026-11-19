export function confirmAction(action: string, name: string, explanation: string) {
  return window.confirm(`${action} “${name}”?\n\n${explanation}`)
}
