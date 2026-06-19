const getMapUrl = (ctx, station) => {
  const hasCoords = !!ctx.session?.userCoords;

  if (hasCoords && station.geom) {
    return `https://www.google.com/maps/search/?api=1&query=${station.geom.lat},${station.geom.lon}`;
  }

  const query = encodeURIComponent(`${station.address}, ${station.city}`);
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
};

module.exports = {
  getMapUrl
};