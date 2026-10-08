import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

export default function NotFoundPage() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>This page could not be found</EmptyTitle>
        <EmptyDescription>Choose Me, Jobs or Settings to continue.</EmptyDescription>
      </EmptyHeader>
      <Button asChild>
        <Link to="/me/outline">Go to Me</Link>
      </Button>
    </Empty>
  );
}
