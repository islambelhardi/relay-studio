import { Workbench } from "@/components/workbench";
import { configuredProviders } from "@/lib/providers";
export default function Page() {
  const providers = configuredProviders();
  return (
    <Workbench
      providers={providers}
      configured={Boolean(
        process.env.NEXT_PUBLIC_SUPABASE_URL &&
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
        process.env.SUPABASE_SERVICE_ROLE_KEY &&
        providers.length,
      )}
    />
  );
}
