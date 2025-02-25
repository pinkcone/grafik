// models/RouteDay.js
module.exports = (sequelize, DataTypes) => {
  const RouteDay = sequelize.define('RouteDay', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    route_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    day_of_week: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 1,
        max: 7
      }
    }
  }, {
    tableName: 'route_days',
    timestamps: false,
  });
  
  return RouteDay;
};
