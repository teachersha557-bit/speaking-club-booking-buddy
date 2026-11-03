export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      booking_classes: {
        Row: {
          attendee_added: boolean
          booking_id: string
          class_id: string
          position: number
        }
        Insert: {
          attendee_added?: boolean
          booking_id: string
          class_id: string
          position: number
        }
        Update: {
          attendee_added?: boolean
          booking_id?: string
          class_id?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "booking_classes_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_classes_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "class_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          calendar_error: string | null
          calendar_status: string
          confirmed_at: string | null
          created_at: string
          hold_expires_at: string | null
          id: string
          payment_link: string | null
          payment_status: string
          price: number
          reference: string
          resolution_note: string | null
          start_date: string
          status: string
          student_id: string
        }
        Insert: {
          calendar_error?: string | null
          calendar_status?: string
          confirmed_at?: string | null
          created_at?: string
          hold_expires_at?: string | null
          id?: string
          payment_link?: string | null
          payment_status?: string
          price?: number
          reference: string
          resolution_note?: string | null
          start_date: string
          status?: string
          student_id: string
        }
        Update: {
          calendar_error?: string | null
          calendar_status?: string
          confirmed_at?: string | null
          created_at?: string
          hold_expires_at?: string | null
          id?: string
          payment_link?: string | null
          payment_status?: string
          price?: number
          reference?: string
          resolution_note?: string | null
          start_date?: string
          status?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      class_sessions: {
        Row: {
          calendar_event_id: string | null
          capacity: number
          class_date: string
          created_at: string
          ends_at: string
          event_error: string | null
          event_status: string
          id: string
          meet_link: string | null
          starts_at: string
          timezone: string
        }
        Insert: {
          calendar_event_id?: string | null
          capacity?: number
          class_date: string
          created_at?: string
          ends_at: string
          event_error?: string | null
          event_status?: string
          id?: string
          meet_link?: string | null
          starts_at: string
          timezone?: string
        }
        Update: {
          calendar_event_id?: string | null
          capacity?: number
          class_date?: string
          created_at?: string
          ends_at?: string
          event_error?: string | null
          event_status?: string
          id?: string
          meet_link?: string | null
          starts_at?: string
          timezone?: string
        }
        Relationships: []
      }
      email_logs: {
        Row: {
          booking_id: string | null
          created_at: string
          email_type: string
          error: string | null
          id: string
          recipient: string
          sent_at: string | null
          status: string
        }
        Insert: {
          booking_id?: string | null
          created_at?: string
          email_type: string
          error?: string | null
          id?: string
          recipient: string
          sent_at?: string | null
          status?: string
        }
        Update: {
          booking_id?: string | null
          created_at?: string
          email_type?: string
          error?: string | null
          id?: string
          recipient?: string
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_logs_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          attempts: number
          booking_id: string | null
          class_date: string | null
          created_at: string
          error: string | null
          id: string
          provider_message_id: string | null
          scheduled_for: string | null
          sent_at: string | null
          status: string
          student_id: string | null
          type: string
          whatsapp_number: string | null
        }
        Insert: {
          attempts?: number
          booking_id?: string | null
          class_date?: string | null
          created_at?: string
          error?: string | null
          id?: string
          provider_message_id?: string | null
          scheduled_for?: string | null
          sent_at?: string | null
          status?: string
          student_id?: string | null
          type: string
          whatsapp_number?: string | null
        }
        Update: {
          attempts?: number
          booking_id?: string | null
          class_date?: string | null
          created_at?: string
          error?: string | null
          id?: string
          provider_message_id?: string | null
          scheduled_for?: string | null
          sent_at?: string | null
          status?: string
          student_id?: string | null
          type?: string
          whatsapp_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number | null
          audit: Json | null
          booking_reference: string | null
          created_at: string
          currency: string | null
          id: string
          is_paid: boolean
          order_number: string
          processed_at: string | null
          resolution_status: string
          status: string | null
          subtotal: number | null
          verification_result: string | null
          verified_at: string | null
        }
        Insert: {
          amount?: number | null
          audit?: Json | null
          booking_reference?: string | null
          created_at?: string
          currency?: string | null
          id?: string
          is_paid?: boolean
          order_number: string
          processed_at?: string | null
          resolution_status?: string
          status?: string | null
          subtotal?: number | null
          verification_result?: string | null
          verified_at?: string | null
        }
        Update: {
          amount?: number | null
          audit?: Json | null
          booking_reference?: string | null
          created_at?: string
          currency?: string | null
          id?: string
          is_paid?: boolean
          order_number?: string
          processed_at?: string | null
          resolution_status?: string
          status?: string | null
          subtotal?: number | null
          verification_result?: string | null
          verified_at?: string | null
        }
        Relationships: []
      }
      students: {
        Row: {
          active: boolean
          created_at: string
          email: string
          id: string
          name: string
          whatsapp: string | null
          whatsapp_consent: boolean
        }
        Insert: {
          active?: boolean
          created_at?: string
          email: string
          id?: string
          name: string
          whatsapp?: string | null
          whatsapp_consent?: boolean
        }
        Update: {
          active?: boolean
          created_at?: string
          email?: string
          id?: string
          name?: string
          whatsapp?: string | null
          whatsapp_consent?: boolean
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      webhook_logs: {
        Row: {
          booking_reference: string | null
          created_at: string
          error: string | null
          event_type: string | null
          id: string
          order_number: string | null
          payload: Json | null
          source: string
          status: string
        }
        Insert: {
          booking_reference?: string | null
          created_at?: string
          error?: string | null
          event_type?: string | null
          id?: string
          order_number?: string | null
          payload?: Json | null
          source?: string
          status?: string
        }
        Update: {
          booking_reference?: string | null
          created_at?: string
          error?: string | null
          event_type?: string | null
          id?: string
          order_number?: string | null
          payload?: Json | null
          source?: string
          status?: string
        }
        Relationships: []
      }
      whatsapp_webhook_events: {
        Row: {
          attempts: number
          delivery_id: string
          event: string
          id: string
          payload: Json
          processed_at: string | null
          processing_error: string | null
          received_at: string
        }
        Insert: {
          attempts?: number
          delivery_id: string
          event: string
          id?: string
          payload: Json
          processed_at?: string | null
          processing_error?: string | null
          received_at?: string
        }
        Update: {
          attempts?: number
          delivery_id?: string
          event?: string
          id?: string
          payload?: Json
          processed_at?: string | null
          processing_error?: string | null
          received_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      confirm_booking: { Args: { _bid: string }; Returns: string }
      create_booking: {
        Args: {
          _consent: boolean
          _email: string
          _name: string
          _ref: string
          _start: string
          _whatsapp: string
        }
        Returns: Json
      }
      ensure_session: { Args: { _d: string }; Returns: string }
      expire_holds: { Args: never; Returns: number }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      seats_taken: {
        Args: { _class_id: string; _exclude?: string }
        Returns: number
      }
    }
    Enums: {
      app_role: "admin"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin"],
    },
  },
} as const
