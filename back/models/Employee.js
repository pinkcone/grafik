// models/Employee.js
module.exports = (sequelize, DataTypes) => {
  const Employee = sequelize.define('Employee', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    first_name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    last_name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    part_time: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 1.0,
    },
    license_category: {
      type: DataTypes.ENUM('B', 'C'),
      allowNull: true,
      comment: 'Najwyższa kategoria prawa jazdy pracownika (C uprawnia też do B)',
    },
    special_permissions: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Czy pracownik posiada specjalne uprawnienia',
    },
    // Klucz do miasta (dla przykładu)
    city_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    // Klucz obcy do użytkownika, który utworzył pracownika
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
  }, {
    tableName: 'employees',
    timestamps: false,
  });
  
  return Employee;
};
