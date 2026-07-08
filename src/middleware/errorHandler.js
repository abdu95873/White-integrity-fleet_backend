export function errorHandler(err, _req, res, _next) {
  console.error(err);

  let message = err instanceof Error ? err.message : "Internal server error";
  let status = 500;

  if (err.name === "ZodError") {
    status = 400;
    message = `Validation failed: ${err.errors.map((e) => e.message).join(", ")}`;
  } else if (err.code === "LIMIT_FILE_SIZE") {
    status = 400;
    message = "File too large. Maximum size is 10MB.";
  } else if (message.includes("not found")) {
    status = 404;
  } else if (message.includes("already")) {
    status = 409;
  } else if (message.includes("Cannot delete batch")) {
    status = 409;
  } else if (
    message.includes("Missing required column") ||
    message.includes("Could not read Excel") ||
    message.includes("empty") ||
    message.includes("No valid courier")
  ) {
    status = 400;
  } else if (message.includes("numeric field overflow")) {
    status = 400;
    message =
      "Invalid amount in Excel file. Check that payment columns contain numbers, not dates or text.";
  } else if (message.includes("Corrupted zip") || message.includes("End of data reached")) {
    status = 400;
    message = "Could not read Excel file. Please upload a valid .xlsx file.";
  }

  res.status(status).json({ error: message });
}
