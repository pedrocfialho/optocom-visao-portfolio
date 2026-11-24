// Contrato das migrations versionadas. Nenhuma credencial faz parte destes tipos.
import type * as F from './finance.types'
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]
export type RecordMeta = { id: string; version: number; created_at: string; updated_at: string; created_by: string | null; updated_by: string | null }
export type Patient = RecordMeta & { full_name: string; phone: string | null; phone_digits: string | null; birth_date: string | null; cpf: string | null; admin_notes: string; active: boolean; registration_pending: boolean }
export type Professional = RecordMeta & { full_name: string; active: boolean }
export type PricedCatalog = RecordMeta & { name: string; default_price: number; active: boolean }
export type AppointmentStatus = 'scheduled' | 'confirmed' | 'attended' | 'cancelled' | 'no_show'
export type Appointment = RecordMeta & { patient_id: string; professional_id: string; appointment_type_id: string; start_at: string; status: AppointmentStatus; admin_notes: string; cancel_reason: string | null }
export type Visit = RecordMeta & { request_id: string; patient_id: string; professional_id: string; appointment_type_id: string; appointment_id: string | null; visit_at: string; consultation_name_snapshot: string; base_price: number; consultation_discount: number; consultation_final: number; total_amount: number; status: 'draft' | 'completed' | 'cancelled'; admin_notes: string; cancel_reason: string | null; cancelled_at: string | null }
export type VisitExam = RecordMeta & { visit_id: string; exam_id: string; exam_name_snapshot: string; unit_price_snapshot: number; active: boolean }
export type AppointmentOverview = Appointment & { patient_name: string; professional_name: string; consultation_name: string; visit_id: string | null; visit_status: Visit['status'] | null; patient_registration_pending: boolean }
export type VisitOverview = Visit & { patient_name: string; professional_name: string }
type Table<Row, Insert = Partial<Row>, Update = Partial<Insert>> = { Row: Row; Insert: Insert; Update: Update; Relationships: [] }
export type Profile = {
  id: string
  full_name: string
  role: 'admin'
  active: boolean
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

export type Database = {
  public: {
    Tables: {
      financial_accounts: Table<F.Account>
      payment_methods: Table<F.PaymentMethod>
      finance_categories: Table<F.Category>
      card_fee_rules: Table<F.FeeRule>
      suppliers: Table<F.Supplier>
      recurring_expenses: Table<F.Recurring>
      loans: Table<F.Loan>
      visit_finance: Table<F.VisitFinance>
      finance_payments: Table<F.Payment>
      finance_entries: Table<F.FinanceEntry>
      finance_movements: Table<F.Movement>
      daily_closings: Table<F.Closing>
      patients: Table<Patient, { full_name: string; phone?: string | null; birth_date?: string | null; cpf?: string | null; admin_notes?: string; active?: boolean; registration_pending?: boolean }>
      professionals: Table<Professional, { full_name: string; active?: boolean }>
      appointment_types: Table<PricedCatalog, { name: string; default_price: number; active?: boolean }>
      exams: Table<PricedCatalog, { name: string; default_price: number; active?: boolean }>
      appointments: Table<Appointment, { patient_id: string; professional_id: string; appointment_type_id: string; start_at: string; status?: AppointmentStatus; admin_notes?: string; cancel_reason?: string | null }>
      visits: Table<Visit>
      visit_exams: Table<VisitExam>
      users_profile: {
        Row: Profile
        Insert: { id: string; full_name: string; role?: 'admin'; active?: boolean }
        Update: { full_name?: string; active?: boolean }
        Relationships: []
      }
    }
    Views: {
      finance_visit_balances: {Row:F.VisitBalance;Relationships:[]}
      finance_entry_overview: {Row:F.EntryOverview;Relationships:[]}
      finance_loan_balances: {Row:F.LoanBalance;Relationships:[]}
      finance_receivables: {Row:F.Receivable;Relationships:[]}
      finance_supplier_balances: {Row:F.SupplierBalance;Relationships:[]}
      appointment_overview: { Row: AppointmentOverview; Relationships: [] }
      visit_overview: { Row: VisitOverview; Relationships: [] }
    }
    Functions: {
      schedule_new_patient: { Args: { p_data: Json }; Returns: Json }
      manage_appointment_removal: {Args:{p_id:string;p_version:number;p_confirm?:boolean};Returns:Json}
      card_settlement_report: {Args:{p_from:string;p_to:string};Returns:Json}
      card_settlement_details: {Args:{p_entry_id:string};Returns:Json}
      card_settlement_exception: {Args:{p_data:Json};Returns:Json}
      manage_record_removal: {Args:{p_table:string;p_id:string;p_version:number;p_confirm?:boolean};Returns:Json}
      finance_catalogs: {Args:Record<string,never>;Returns:Json}
      finance_command: {Args:{p_data:Json};Returns:Json}
      finance_report: {Args:{p_from:string;p_to:string};Returns:Json}
      is_active_admin: { Args: Record<string, never>; Returns: boolean }
      search_patients: { Args: { p_query?: string; p_offset?: number; p_active_only?: boolean }; Returns: Patient[] }
      start_visit: { Args: { p_appointment_id: string }; Returns: Json }
      save_visit: { Args: { p_data: Json }; Returns: Json }
      cancel_visit: { Args: { p_id: string; p_version: number; p_reason: string }; Returns: Json }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
