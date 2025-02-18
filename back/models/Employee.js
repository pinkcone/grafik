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
      city_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      }
    }, {
      tableName: 'employees',
      timestamps: false,
    });
    
    return Employee;
  };
  