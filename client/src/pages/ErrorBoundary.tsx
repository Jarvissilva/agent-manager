import {
  isRouteErrorResponse,
  useRevalidator,
  useRouteError,
} from 'react-router';

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
    <main>
      <h1>Could not load this page</h1>
      <p role="alert" className="error">
        {message}
      </p>
      <button
        onClick={() => void revalidator.revalidate()}
        disabled={revalidator.state !== 'idle'}
      >
        {revalidator.state === 'idle' ? 'Try again' : 'Retrying…'}
      </button>
    </main>
  );
}
