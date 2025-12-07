from backend.main import app as application

# Vercel looks for a module-level variable named `app` or `application`.
# Using `application` keeps compatibility with common serverless adapters.
app = application
