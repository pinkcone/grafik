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
    required_license_category: {
      type: DataTypes.ENUM('B', 'C'),
      allowNull: false,
      defaultValue: 'B',
      comment: 'Wymagana kategoria prawa jazdy na trasie (bus = B, ciężarówka = C)',
    },
    requires_special_permissions: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Czy trasa wymaga specjalnych uprawnień pracownika',
    },
    requires_staffing: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      comment: 'Czy trasa musi być obsadzona (false = może zostać pusta przy braku kierowców)',
    },
    linked_route_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    // Klucz obcy do użytkownika, który utworzył trasę
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
  }, {
    tableName: 'routes',
    timestamps: false,
  });
  
  return Route;
};
