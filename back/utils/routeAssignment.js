const { canDriveWithCategory } = require('./licenseCategories');

const toBoolean = (value) => {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return false;
};

const hasSpecialPermissions = (value) => toBoolean(value);

const canAssignEmployeeToRoute = (employee, route) => {
  if (!employee || !route) return false;

  if (!canDriveWithCategory(employee.license_category, route.required_license_category || 'B')) {
    return false;
  }

  if (hasSpecialPermissions(route.requires_special_permissions) && !hasSpecialPermissions(employee.special_permissions)) {
    return false;
  }

  return true;
};

module.exports = {
  toBoolean,
  hasSpecialPermissions,
  canAssignEmployeeToRoute,
};
