// models/Route.js
module.exports = (sequelize, DataTypes) => {
    const Route = sequelize.define('Route', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      main_city_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      additional_city_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      working_hours: {
        type: DataTypes.JSON,
        allowNull: false,
        // Przykład: { segments: [{start: "08:00", end: "13:00"}, {start: "14:30", end: "20:00"}] }
      },
      linked_route_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      }
    }, {
      tableName: 'routes',
      timestamps: false,
    });
    
    return Route;
  };
  