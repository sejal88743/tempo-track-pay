export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      advances: {
        Row: {
          amount: number;
          created_at: string;
          deducted: boolean;
          deducted_in_month: string | null;
          employee_id: string;
          id: string;
          reason: string | null;
          status: Database["public"]["Enums"]["request_status"];
          taken_on: string;
        };
        Insert: {
          amount: number;
          created_at?: string;
          deducted?: boolean;
          deducted_in_month?: string | null;
          employee_id: string;
          id?: string;
          reason?: string | null;
          status?: Database["public"]["Enums"]["request_status"];
          taken_on?: string;
        };
        Update: {
          amount?: number;
          created_at?: string;
          deducted?: boolean;
          deducted_in_month?: string | null;
          employee_id?: string;
          id?: string;
          reason?: string | null;
          status?: Database["public"]["Enums"]["request_status"];
          taken_on?: string;
        };
        Relationships: [
          {
            foreignKeyName: "advances_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
        ];
      };
      attendance: {
        Row: {
          accuracy_meters: number | null;
          attendance_date: string;
          created_at: string;
          daily_salary_override: number | null;
          device_id: string | null;
          employee_id: string;
          id: string;
          in_time: string | null;
          late_minutes: number | null;
          latitude: number | null;
          location_ok: boolean | null;
          longitude: number | null;
          marked_by: string | null;
          method: string | null;
          notes: string | null;
          out_time: string | null;
          shift: Database["public"]["Enums"]["shift_type"];
          status: Database["public"]["Enums"]["attendance_status"];
          tempo_id: string | null;
          updated_at: string;
        };
        Insert: {
          accuracy_meters?: number | null;
          attendance_date?: string;
          created_at?: string;
          daily_salary_override?: number | null;
          device_id?: string | null;
          employee_id: string;
          id?: string;
          in_time?: string | null;
          late_minutes?: number | null;
          latitude?: number | null;
          location_ok?: boolean | null;
          longitude?: number | null;
          marked_by?: string | null;
          method?: string | null;
          notes?: string | null;
          out_time?: string | null;
          shift?: Database["public"]["Enums"]["shift_type"];
          status?: Database["public"]["Enums"]["attendance_status"];
          tempo_id?: string | null;
          updated_at?: string;
        };
        Update: {
          accuracy_meters?: number | null;
          attendance_date?: string;
          created_at?: string;
          daily_salary_override?: number | null;
          device_id?: string | null;
          employee_id?: string;
          id?: string;
          in_time?: string | null;
          late_minutes?: number | null;
          latitude?: number | null;
          location_ok?: boolean | null;
          longitude?: number | null;
          marked_by?: string | null;
          method?: string | null;
          notes?: string | null;
          out_time?: string | null;
          shift?: Database["public"]["Enums"]["shift_type"];
          status?: Database["public"]["Enums"]["attendance_status"];
          tempo_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "attendance_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attendance_tempo_id_fkey";
            columns: ["tempo_id"];
            isOneToOne: false;
            referencedRelation: "tempos";
            referencedColumns: ["id"];
          },
        ];
      };
      employees: {
        Row: {
          active: boolean;
          address: string | null;
          assigned_godown_id: string | null;
          biometric_enrolled: boolean;
          created_at: string;
          credential_ids: string[] | null;
          employee_code: string;
          extra_roles: string[] | null;
          face_descriptor: number[] | null;
          full_name: string;
          id: string;
          joining_date: string;
          mobile_number: string | null;
          monthly_salary: number;
          photo_url: string | null;
          roles: string[];
          salary_type: Database["public"]["Enums"]["salary_type"];
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          address?: string | null;
          assigned_godown_id?: string | null;
          biometric_enrolled?: boolean;
          created_at?: string;
          credential_ids?: string[] | null;
          employee_code: string;
          extra_roles?: string[] | null;
          face_descriptor?: number[] | null;
          full_name: string;
          id?: string;
          joining_date?: string;
          mobile_number?: string | null;
          monthly_salary?: number;
          photo_url?: string | null;
          roles?: string[];
          salary_type?: Database["public"]["Enums"]["salary_type"];
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          address?: string | null;
          assigned_godown_id?: string | null;
          biometric_enrolled?: boolean;
          created_at?: string;
          credential_ids?: string[] | null;
          employee_code?: string;
          extra_roles?: string[] | null;
          face_descriptor?: number[] | null;
          full_name?: string;
          id?: string;
          joining_date?: string;
          mobile_number?: string | null;
          monthly_salary?: number;
          photo_url?: string | null;
          roles?: string[];
          salary_type?: Database["public"]["Enums"]["salary_type"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "employees_assigned_godown_id_fkey";
            columns: ["assigned_godown_id"];
            isOneToOne: false;
            referencedRelation: "godowns";
            referencedColumns: ["id"];
          },
        ];
      };
      godowns: {
        Row: {
          active: boolean;
          address: string | null;
          created_at: string;
          id: string;
          latitude: number | null;
          longitude: number | null;
          name: string;
          radius_meters: number;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          address?: string | null;
          created_at?: string;
          id?: string;
          latitude?: number | null;
          longitude?: number | null;
          name: string;
          radius_meters?: number;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          address?: string | null;
          created_at?: string;
          id?: string;
          latitude?: number | null;
          longitude?: number | null;
          name?: string;
          radius_meters?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      leaves: {
        Row: {
          created_at: string;
          decided_at: string | null;
          employee_id: string;
          from_date: string;
          id: string;
          leave_type: Database["public"]["Enums"]["leave_type"];
          reason: string | null;
          status: Database["public"]["Enums"]["request_status"];
          to_date: string;
        };
        Insert: {
          created_at?: string;
          decided_at?: string | null;
          employee_id: string;
          from_date: string;
          id?: string;
          leave_type?: Database["public"]["Enums"]["leave_type"];
          reason?: string | null;
          status?: Database["public"]["Enums"]["request_status"];
          to_date: string;
        };
        Update: {
          created_at?: string;
          decided_at?: string | null;
          employee_id?: string;
          from_date?: string;
          id?: string;
          leave_type?: Database["public"]["Enums"]["leave_type"];
          reason?: string | null;
          status?: Database["public"]["Enums"]["request_status"];
          to_date?: string;
        };
        Relationships: [
          {
            foreignKeyName: "leaves_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
        ];
      };
      salaries: {
        Row: {
          absent_days: number;
          advance_deducted: number;
          bonus: number;
          employee_id: string;
          final_salary: number;
          generated_at: string;
          gross: number;
          id: string;
          leave_deduction: number;
          month: string;
          paid_leave_days: number;
          penalty: number;
          per_day: number;
          present_days: number;
          total_days: number;
          unpaid_leave_days: number;
        };
        Insert: {
          absent_days?: number;
          advance_deducted?: number;
          bonus?: number;
          employee_id: string;
          final_salary?: number;
          generated_at?: string;
          gross?: number;
          id?: string;
          leave_deduction?: number;
          month: string;
          paid_leave_days?: number;
          penalty?: number;
          per_day?: number;
          present_days?: number;
          total_days: number;
          unpaid_leave_days?: number;
        };
        Update: {
          absent_days?: number;
          advance_deducted?: number;
          bonus?: number;
          employee_id?: string;
          final_salary?: number;
          generated_at?: string;
          gross?: number;
          id?: string;
          leave_deduction?: number;
          month?: string;
          paid_leave_days?: number;
          penalty?: number;
          per_day?: number;
          present_days?: number;
          total_days?: number;
          unpaid_leave_days?: number;
        };
        Relationships: [
          {
            foreignKeyName: "salaries_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
        ];
      };
      sessions: {
        Row: {
          created_at: string;
          display_name: string | null;
          expires_at: string;
          role: Database["public"]["Enums"]["app_role"];
          subject_id: string | null;
          token: string;
        };
        Insert: {
          created_at?: string;
          display_name?: string | null;
          expires_at: string;
          role: Database["public"]["Enums"]["app_role"];
          subject_id?: string | null;
          token: string;
        };
        Update: {
          created_at?: string;
          display_name?: string | null;
          expires_at?: string;
          role?: Database["public"]["Enums"]["app_role"];
          subject_id?: string | null;
          token?: string;
        };
        Relationships: [];
      };
      settings: {
        Row: {
          key: string;
          updated_at: string;
          value: Json;
        };
        Insert: {
          key: string;
          updated_at?: string;
          value: Json;
        };
        Update: {
          key?: string;
          updated_at?: string;
          value?: Json;
        };
        Relationships: [];
      };
      tempo_assignments: {
        Row: {
          assignment_date: string;
          created_at: string;
          employee_id: string;
          id: string;
          notes: string | null;
          role: string;
          tempo_id: string;
        };
        Insert: {
          assignment_date?: string;
          created_at?: string;
          employee_id: string;
          id?: string;
          notes?: string | null;
          role?: string;
          tempo_id: string;
        };
        Update: {
          assignment_date?: string;
          created_at?: string;
          employee_id?: string;
          id?: string;
          notes?: string | null;
          role?: string;
          tempo_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tempo_assignments_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tempo_assignments_tempo_id_fkey";
            columns: ["tempo_id"];
            isOneToOne: false;
            referencedRelation: "tempos";
            referencedColumns: ["id"];
          },
        ];
      };
      tempos: {
        Row: {
          active: boolean;
          assigned_route: string | null;
          created_at: string;
          id: string;
          model: string | null;
          updated_at: string;
          vehicle_number: string;
        };
        Insert: {
          active?: boolean;
          assigned_route?: string | null;
          created_at?: string;
          id?: string;
          model?: string | null;
          updated_at?: string;
          vehicle_number: string;
        };
        Update: {
          active?: boolean;
          assigned_route?: string | null;
          created_at?: string;
          id?: string;
          model?: string | null;
          updated_at?: string;
          vehicle_number?: string;
        };
        Relationships: [];
      };
      worker_credentials: {
        Row: {
          created_at: string;
          employee_id: string;
          password_hash: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          employee_id: string;
          password_hash: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          employee_id?: string;
          password_hash?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "worker_credentials_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: true;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      exec_sql: { Args: { params?: Json; sql: string }; Returns: Json };
    };
    Enums: {
      app_role: "admin" | "worker";
      attendance_status: "present" | "absent" | "late";
      leave_type: "casual" | "sick" | "paid" | "unpaid";
      request_status: "pending" | "approved" | "rejected";
      salary_type: "monthly" | "daily";
      shift_type: "morning" | "evening";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "worker"],
      attendance_status: ["present", "absent", "late"],
      leave_type: ["casual", "sick", "paid", "unpaid"],
      request_status: ["pending", "approved", "rejected"],
      salary_type: ["monthly", "daily"],
      shift_type: ["morning", "evening"],
    },
  },
} as const;
