import { Navigate } from "react-router-dom";
import { useOnboardingStatus } from "@/api/queries";
import { PageLoading } from "@/components/PageState";

/** New people land on getting started; everyone else lands on what needs attention. */
export default function HomeRedirect() {
  const status = useOnboardingStatus();
  if (status.isPending) return <PageLoading />;
  const fresh =
    status.data && (!status.data.hasProfileName || status.data.outlineIsStarter) && !status.data.masterExists;
  return <Navigate to={fresh ? "/start" : "/jobs"} replace />;
}
