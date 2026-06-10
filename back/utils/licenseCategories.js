const LICENSE_CATEGORIES = ['B', 'C'];

/** Kategoria C uprawnia również do prowadzenia pojazdów kat. B. */
const IMPLIES = {
  B: ['B'],
  C: ['B', 'C'],
};

const canDriveWithCategory = (employeeCategory, requiredCategory) => {
  if (!requiredCategory) return true;
  if (!employeeCategory) return true;
  const allowed = IMPLIES[employeeCategory];
  if (!allowed) return false;
  return allowed.includes(requiredCategory);
};

const effectiveCategories = (employeeCategory) => {
  if (!employeeCategory) return [];
  return IMPLIES[employeeCategory] || [employeeCategory];
};

module.exports = {
  LICENSE_CATEGORIES,
  IMPLIES,
  canDriveWithCategory,
  effectiveCategories,
};
