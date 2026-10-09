"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/shared/states";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const notFound = /not found/i.test(error.message);
  return (
    <ErrorState
      title={notFound ? "Not found" : "Something went wrong while loading this page"}
      message={notFound ? error.message : "Please try again. If it keeps happening, check your connection or contact the administrator."}
      onRetry={reset}
    />
  );
}
