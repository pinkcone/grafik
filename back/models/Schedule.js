// models/Schedule.js
module.exports = (sequelize, DataTypes) => {
    const Schedule = sequelize.define('Schedule', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      employee_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      date: {
        type: DataTypes.DATEONLY,
        allowNull: false
      },
      assignment_type: {
        type: DataTypes.ENUM('route', 'label'),
        allowNull: false
      },
      route_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      label: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      worked_hours: {
        type: DataTypes.FLOAT,
        allowNull: true,
      }
    }, {
      tableName: 'schedule',
      timestamps: false,
    });
    
    return Schedule;
  };
  