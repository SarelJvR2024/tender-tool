"use client";

// A plain form-submit button that asks for confirmation first, for
// destructive actions (Remove/Delete) inside server-component pages that
// post to a Server Action. The surrounding <form> and its action are
// untouched - this only intercepts the click.
export function ConfirmSubmitButton({
  confirmMessage,
  style,
  children,
}: {
  confirmMessage: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      style={style}
      onClick={(e) => {
        if (!window.confirm(confirmMessage)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
