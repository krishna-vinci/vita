import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/api/queries";
import AuthLayout from "./AuthLayout";
import { ChangePasswordForm } from "./ChangePasswordForm";

/** After an admin sets a temporary password, nothing else works until you choose your own. */
export default function ForcedPasswordChange() {
  const client = useQueryClient();
  return (
    <AuthLayout
      title="Choose your own password"
      subtitle="Your password was set by an administrator. Pick a new one to continue."
    >
      <ChangePasswordForm
        submitLabel="Save and continue"
        onDone={() => void client.invalidateQueries({ queryKey: queryKeys.auth })}
      />
    </AuthLayout>
  );
}
