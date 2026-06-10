export const LICENSE_CATEGORIES = ['B', 'C'];

export const LICENSE_CATEGORY_LABELS = {
  B: 'B (bus)',
  C: 'C (ciężarówka — uprawnia też do B)',
};

const IMPLIES = {
  B: ['B'],
  C: ['B', 'C'],
};

export const canDriveWithCategory = (employeeCategory, requiredCategory) => {
  if (!requiredCategory) return true;
  if (!employeeCategory) return true;
  const allowed = IMPLIES[employeeCategory];
  if (!allowed) return false;
  return allowed.includes(requiredCategory);
};

export const effectiveCategories = (employeeCategory) => {
  if (!employeeCategory) return [];
  return IMPLIES[employeeCategory] || [employeeCategory];
};
