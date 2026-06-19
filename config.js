const tokens = require('./token');
module.exports = {
  FRANCE_API_URL: 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records',

  GERMANY_API_URL: 'https://creativecommons.tankerkoenig.de/json/list.php',
  GERMANY_API_KEY: tokens.GERMANY_API_KEY,

  SPAIN_API_URL: 'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/',

  SUPPORTED_COUNTRIES: ['FR', 'DE', 'ES'],
  TIMEZONE: 'Europe/Paris',
  STATIONS_LIMIT: 10
};