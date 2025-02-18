// models/Label.js
module.exports = (sequelize, DataTypes) => {
    const Label = sequelize.define('Label', {
      code: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
      },
      default_hours: {
        type: DataTypes.FLOAT,
        allowNull: false,
      },
      description: {
        type: DataTypes.STRING,
        allowNull: true,
      }
    }, {
      tableName: 'labels',
      timestamps: false,
    });
    
    return Label;
  };
  