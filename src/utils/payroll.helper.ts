// ─── 1. THE SALARY SPLITTER ──────────────────────────────────────────────────
/**
 * Splits the total monthly CTC into Basic and Allowances based on the employee's specific policy.
 * * @param monthlyCTC - The employee's total fixed monthly salary
 * @param structure - The percentage policy (defaults to 100% Basic if missing)
 * @returns Object containing the exact Rupee breakdown
 */
export const calculateSalarySplit = (
    monthlyCTC: number,
    structure: { basicPercentage: number; allowancePercentage: number } = { basicPercentage: 100, allowancePercentage: 0 }
) => {
    // 1. Calculate the exact Rupee amounts based on the percentages
    const basic = parseFloat(((monthlyCTC * structure.basicPercentage) / 100).toFixed(2));
    const allowances = parseFloat(((monthlyCTC * structure.allowancePercentage) / 100).toFixed(2));

    return {
        basic,
        allowances,
        totalCTC: monthlyCTC
    };
};


// ─── 2. THE PROFESSIONAL TAX (PT) ENGINE ─────────────────────────────────────
/**
 * Calculates Maharashtra Professional Tax.
 * CRITICAL FIX: PT is evaluated against the 'Base Salary', NOT the gross/prorated earnings.
 * * @param basicSalary - The SPLIT basic salary (from calculateSalarySplit), NOT total gross.
 * @param gender - 'male', 'female', or 'other'
 * @param monthIndex - 0-indexed month (0 = Jan, 1 = Feb, etc.)
 */
export const calculatePT = (basicSalary: number, gender: string, monthIndex: number): number => {
    const normalizedGender = gender?.toLowerCase();
    const isFebruary = monthIndex === 1;

    // =========================
    // FEMALE TIER
    // =========================
    if (normalizedGender === 'female') {
        if (basicSalary <= 25000) return 0;
        if (isFebruary) return 300;
        return 200;
    }

    // =========================
    // MALE / OTHER TIER
    // =========================
    if (basicSalary <= 7500) return 0;
    
    // Note: Kept the 175 tier as per your original logic, 
    // update this if Maharashtra formally drops the 10k bracket.
    if (basicSalary <= 10000) return 175; 

    // Above 10,000
    if (isFebruary) return 300;
    
    return 200;
};


// ─── 3. PRORATA CALCULATOR (CYCLE MATH) ──────────────────────────────────────
/**
 * Calculates the actual payable amount based on days worked vs total cycle days.
 * * @param fullAmount - The monthly amount (Basic or Allowance)
 * @param totalCycleDays - The number of days in the cycle (e.g., 30 or 31)
 * @param paidDays - The number of days the employee is actually getting paid for
 */
export const calculateProratedAmount = (fullAmount: number, totalCycleDays: number, paidDays: number): number => {
    // Prevent division by zero just in case
    if (totalCycleDays === 0) return 0;
    
    const dailyRate = fullAmount / totalCycleDays;
    return parseFloat((dailyRate * paidDays).toFixed(2));
};