const fuelTypes = {
  'fuel_gazole': { label: 'Diesel', frField: 'gazole_prix' },
  'fuel_e10': { label: 'E10', frField: 'e10_prix' },
  'fuel_sp98': { label: 'SP98', frField: 'sp98_prix' },
  'fuel_gplc': { label: 'GPL', frField: 'gplc_prix' }
};

const geoRegex = /^[-+]?([1-8]?\d(\.\d+)?|90(\.0+)?),\s*[-+]?(180(\.0+)?|((1[0-7]\d)|([1-9]?\d))(\.\d+)?)$/;

module.exports = {
  fuelTypes,
  geoRegex
};