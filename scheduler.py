"""
scheduler.py - Top-Level Runner for Cron and GitHub Actions.
Usage:
    python scheduler.py --limit 50 --output provider_emails.csv
"""

from email_finder.scheduler import main

if __name__ == "__main__":
    main()
