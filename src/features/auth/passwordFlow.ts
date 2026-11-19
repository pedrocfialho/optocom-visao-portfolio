export const PASSWORD_SETUP_STORAGE_KEY = 'optocom.password-setup-user'

export function passwordFlowFromHash(hash: string): boolean {
  const type = new URLSearchParams(hash.replace(/^#/, '')).get('type')
  return type === 'invite' || type === 'recovery'
}

// Capturar apenas a intenção, antes que o SDK consuma e limpe o fragmento.
// Nenhum token é copiado, registrado ou interpretado pela aplicação.
export const initialPasswordFlow = typeof window !== 'undefined' && passwordFlowFromHash(window.location.hash)
