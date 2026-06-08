type TimeFormat = 'date' | 'time' | 'day' | 'full';

// ── TYPESCRIPT OVERLOADS (Solves the Mongoose Type Error) ──
export function getIST(format: TimeFormat, inputDate?: Date | string | number): string;
export function getIST(format?: undefined, inputDate?: Date | string | number): Date;

/**
 * Centralized Utility to safely get Indian Standard Time (IST) in Database-Friendly Formats
 * @param format - 'date' (YYYY-MM-DD), 'time' (HH:mm:ss), 'day' (Monday), 'full' (YYYY-MM-DD HH:mm:ss), or empty for standard UTC Date object.
 * @param inputDate - Optional: Pass an existing Date or string to convert it. Defaults to current time.
 */
export function getIST(format?: TimeFormat, inputDate?: Date | string | number): string | Date {
    // 1. Initialize the target date
    const target = inputDate ? new Date(inputDate) : new Date();

    // 2. If nothing is passed, return the standard Date object (UTC, native for MongoDB)
    if (!format) {
        return target;
    }

    // 3. Define strict IST timezone
    const timeZone = 'Asia/Kolkata';

    switch (format) {
        case 'date': {
            // Returns: "YYYY-MM-DD" (Perfect for MongoDB exact string matching)
            return new Intl.DateTimeFormat('en-CA', {
                timeZone,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
            }).format(target);
        }

        case 'time': {
            // Returns: "HH:mm:ss" (24-hour format, perfect for > or < string comparisons)
            return new Intl.DateTimeFormat('en-GB', {
                timeZone,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false, // Strictly 24-hour for the database
            }).format(target);
        }

        case 'day': {
            // Returns: "Monday", "Tuesday", etc. (Standard English)
            return new Intl.DateTimeFormat('en-US', {
                timeZone,
                weekday: 'long',
            }).format(target);
        }

        case 'full': {
            // Returns: "YYYY-MM-DD HH:mm:ss" (Clean, sortable timestamp string)
            const datePart = new Intl.DateTimeFormat('en-CA', {
                timeZone,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            }).format(target);

            const timePart = new Intl.DateTimeFormat('en-GB', {
                timeZone,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            }).format(target);

            return `${datePart} ${timePart}`;
        }

        default:
            return target;
    }
}

/**
 * Creates a native Date object for a specific time today in IST.
 * @param timeString - Must be in 'HH:mm:ss' format (e.g., '09:30:00' or '14:00:00')
 */
export function createTodayISTThreshold(timeString: string): Date {
    const todayDate = getIST('date'); // Gets "YYYY-MM-DD"
    // Safely builds the ISO string: "2026-06-08T09:30:00+05:30"
    return new Date(`${todayDate}T${timeString}+05:30`);
}