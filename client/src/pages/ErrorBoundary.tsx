import {
  isRouteErrorResponse,
  useRevalidator,
  useRouteError,
} from 'react-router';
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
export default function ErrorBoundary() {
  const error = useRouteError();
  const revalidator = useRevalidator();
  const message =
    error instanceof Error
      ? error.message
      : isRouteErrorResponse(error)
        ? `${error.status} ${error.statusText}`
        : 'Something went wrong. Please try again.';
  return (
    <main className="mx-auto w-full max-w-xl space-y-6 px-3 py-12 sm:px-4">
      <h1 className="text-2xl font-medium tracking-tight">
        Could not load this page
      </h1>
      <Alert variant="destructive">
        <AlertCircle />
        <AlertTitle>Something needs attention</AlertTitle>
        <AlertDescription>{message}</AlertDescription>
      </Alert>
      <Button
        disabled={revalidator.state !== 'idle'}
        onClick={() => void revalidator.revalidate()}
      >
        {revalidator.state === 'idle' ? 'Try again' : 'Retrying…'}
      </Button>
    </main>
  );
}
