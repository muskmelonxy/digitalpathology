const path = require('path');
const fs = require('fs');

const UPLOADS = path.join(__dirname, '../../uploads');

function slideAssetFlags(id) {
  const exists = (dir) => fs.existsSync(path.join(UPLOADS, dir, `${id}.jpg`));
  return {
    has_label: exists('labels'),
    has_macro: exists('macros'),
    has_overview: exists('overviews')
  };
}

module.exports = { slideAssetFlags, UPLOADS };