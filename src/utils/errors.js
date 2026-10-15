const isClientError = (error) =>
  error?.name === "ValidationError" || error?.name === "CastError";

// HTTP status for an error caught in a route: bad input is the client's
// fault (400), anything else is ours (500).
export const errorStatus = (error) => (isClientError(error) ? 400 : 500);

// Message that is safe to send to the client. Validation messages are written
// for users; anything else (DB/driver/internal errors) is logged and hidden.
export const publicError = (error) => {
  if (error?.name === "ValidationError") {
    return Object.values(error.errors)
      .map((e) => e.message)
      .join(", ");
  }
  if (error?.name === "CastError") return "Invalid id";
  console.error(error);
  return "Something went wrong";
};
