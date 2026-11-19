export const APP_TIMEZONE = 'America/Sao_Paulo'
export function clinicDate(date = new Date()) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full', timeZone: APP_TIMEZONE }).format(date)
}
