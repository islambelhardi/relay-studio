import { Workbench } from "@/components/workbench";
export default function Page() {
  return (
    <Workbench
      configured={Boolean(
        process.env.NEXT_PUBLIC_SUPABASE_URL &&
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
        process.env.SUPABASE_SERVICE_ROLE_KEY &&
        process.env.OPENAI_API_KEY,
      )}
    />
  );
}
