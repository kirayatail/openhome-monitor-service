"use strict";

let _ = require('underscore');
let upnp = require("./soap.js");
let xml2js = require('xml2js');
let xmlParser = new xml2js.Parser({explicitArray: false});
let responseParser = require('parsexmlresponse');
let binary = require('binary');

function encode(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
function toTrack(callback) {
    return function(err, result) {
        if (result['s:Envelope']['s:Body']['u:TrackResponse'].Uri) {
            callback(null, {
                track: result['s:Envelope']['s:Body']['u:TrackResponse'].Uri,
                metadata: result['s:Envelope']['s:Body']['u:TrackResponse'].Metadata
            });
        } else {
            callback(new Error('No track found'));
        }
    };
}
function binaryIdArrayToIntList(callback) {
    return function (err, data) {
        let buffer = new Buffer.from(data['s:Envelope']['s:Body']['u:IdArrayResponse'].Array, 'base64');
        let arrayList = [];
        let binaryList = binary.parse(buffer);
        _.each(_.range(buffer.length / 4), function () {
            arrayList.push(binaryList.word32bu('a').vars.a);
        });
        callback(null, _.reject(arrayList, function (num) { return num === 0; })); 
    };
}
function toSourceList(callback) {
    return function toSources(err, data) {
        if (data && data['s:Envelope']['s:Body']['u:SourceXmlResponse']) {
            xmlParser.parseString(data['s:Envelope']['s:Body']['u:SourceXmlResponse'].Value, function (err, result) {
                if (err) {
                    callback(err);
                } else {
                    if (_.isArray(result.SourceList.Source)) {
                        callback(null, _.map(result.SourceList.Source, function (source) {
                            return {
                                name: source.Name,
                                type: source.Type,
                                visible: source.Visible.toLowerCase() === 'true'
                            };
                        }));
                    } else {
                        callback(null, [{
                            name: result.SourceList.Source.Name,
                            type: result.SourceList.Source.Type,
                            visible: result.SourceList.Source.Visible.toLowerCase() === 'true'
                        }]);
                    }
                }
            });
        } else {
            callback(new Error('No sourceXml Found'));
        }
    };
}
function parseNewId(callback) {
    return function(err, result) {
        if (result['s:Envelope']['s:Body']['u:InsertResponse']) {
            callback(null, result['s:Envelope']['s:Body']['u:InsertResponse'].NewId);
        } else {
            callback(new Error('No NewId Found'));
        }
    };
}
function readTrackListResponseToTracks(callback) {
    return function(err, data) {
        xmlParser.parseString(data['s:Envelope']['s:Body']['u:ReadListResponse'].TrackList, function (err, result) {
            if (err) {
                callback(err);
            } else {
                let tracks = [];
                if (_.isArray(result.TrackList.Entry)) {
                    _.each(result.TrackList.Entry, function (track) {
                        tracks.push({
                            track: track.Uri,
                            metadata: track.Metadata
                        });
                    });
                } else {
                    if (result.TrackList.Entry) {
                        tracks.push({
                            track: result.TrackList.Entry.Uri,
                            metadata: result.TrackList.Entry.Metadata
                        });
                    }
                }
                callback(null, tracks);
            }
        });
    }
}
function processChannelListEntry(channelListEntry, callback) {
    xmlParser.parseString(channelListEntry.Metadata, function (err, result) {
        callback(null, {
            title: _.isObject(result['DIDL-Lite'].item['dc:title']) ? result['DIDL-Lite'].item['dc:title']._ : result['DIDL-Lite'].item['dc:title'],
            artwork: _.isObject(result['DIDL-Lite'].item['upnp:albumArtURI']) ? result['DIDL-Lite'].item['upnp:albumArtURI']._ : result['DIDL-Lite'].item['upnp:albumArtURI'],
            uri: _.isObject(result['DIDL-Lite'].item.res) ? result['DIDL-Lite'].item.res._ : result['DIDL-Lite'].item.res
        });
    });
}
function readChannelListResponseToTracks(callback) {
    return function(err, data) {
        xmlParser.parseString(data['s:Envelope']['s:Body']['u:ReadListResponse'].ChannelList, function (err, result) {
            if (err) {
                callback(err);
            } else {
                let channelList = [];
                if (_.isArray(result.ChannelList.Entry)) {
                    _.each(result.ChannelList.Entry, function (channel) {
                        processChannelListEntry(channel, function (err, data2) {
                            channelList.push({
                                id: channel.Id,
                                uri: data2.uri,
                                title: data2.title,
                                artwork: data2.artwork
                            });
                        });
                    });
                } else {
                    if (result.ChannelList.Entry) {
                        processChannelListEntry(result.ChannelList.Entry, function (err, data2) {
                            channelList.push({
                                id: result.ChannelList.Entry.Id,
                                uri: data2.uri,
                                title: data2.title,
                                artwork: data2.artwork
                            });
                        });
                    }
                }
                callback(null, channelList);
            }
        });
    };
}
function parseStandbyResponse(callback) {
    return function (err, result) {
        callback(null, result['s:Envelope']['s:Body']['u:StandbyResponse'].Value);
    };
}
function ensureStatusCode(expectedStatusCode, taskMessage, callback) {
    return function statusChecker(res) {
        if (res.statusCode === expectedStatusCode) {
            callback();
        } else {
            callback(new Error(taskMessage + ": Failed with status " + res.statusCode));
        }
    };
}
exports.Ds = function(deviceUrlRoot, serviceList) {
    this.retrieveTrackDetails = function(idArray, callback) {
        let idArrayString = _.reduce(idArray, function (memo, num) { return memo + num + ' '; }, '').trim();
        upnp.soapRequest(
            deviceUrlRoot,
            serviceList['urn:av-openhome-org:serviceId:Playlist'].controlUrl,
            serviceList['urn:av-openhome-org:serviceId:Playlist'].serviceType,
            'ReadList',
            '<IdList>' + idArrayString + '</IdList>',
            responseParser(readTrackListResponseToTracks(callback))
        ).on('error', callback);
    };
    this.getTrackIds = function(callback) {
        upnp.soapRequest(
            deviceUrlRoot,
            serviceList['urn:av-openhome-org:serviceId:Playlist'].controlUrl,
            serviceList['urn:av-openhome-org:serviceId:Playlist'].serviceType,
            'IdArray',
            '',
            responseParser(binaryIdArrayToIntList(callback))
        ).on('error', callback);
    };
    this.deleteAll = function(callback) {
        upnp.soapRequest(
            deviceUrlRoot,
            serviceList['urn:av-openhome-org:serviceId:Playlist'].controlUrl,
            serviceList['urn:av-openhome-org:serviceId:Playlist'].serviceType,
            'DeleteAll',
            '',
            ensureStatusCode(200, "Delete", callback)
        ).on('error', callback);
    };
    this.enableShuffle = function (callback) {
        upnp.soapRequest(
            deviceUrlRoot,
            serviceList['urn:av-openhome-org:serviceId:Playlist'].controlUrl,
            serviceList['urn:av-openhome-org:serviceId:Playlist'].serviceType,
            'SetShuffle',
            '<Value>1</Value>',
            ensureStatusCode(200, "Enable Shuffle", callback)
        ).on('error', callback);
    };
    this.disableShuffle = function (callback) {
        upnp.soapRequest(
            deviceUrlRoot,
            serviceList['urn:av-openhome-org:serviceId:Playlist'].controlUrl,
            serviceList['urn:av-openhome-org:serviceId:Playlist'].serviceType,
            'SetShuffle',
            '<Value>0</Value>',
            ensureStatusCode(200, "Disable Shuffle", callback)
        ).on('error', callback);
    };
    this.playFromPlaylistIndex = function (index, callback) {
        upnp.soapRequest(
            deviceUrlRoot,
            serviceList['urn:av-openhome-org:serviceId:Playlist'].controlUrl,
            serviceList['urn:av-openhome-org:serviceId:Playlist'].serviceType,
            'SeekIndex',
            '<Value>' + index + '</Value>',
            ensureStatusCode(200, "Play Playlist From Index " + index, callback)
        ).on('error', callback);
    };
    this.playPlaylist = function (callback) {
        upnp.soapRequest(
            deviceUrlRoot,
            serviceList['urn:av-openhome-org:serviceId:Playlist'].controlUrl,
            serviceList['urn:av-openhome-org:serviceId:Playlist'].serviceType,
            'Play',
            '',
            ensureStatusCode(200, "Play Playlist", callback)
        ).on('error', callback);
    };
    this.queueTrack = function(trackDetailsXml, afterId, callback) {
        xmlParser.parseString(trackDetailsXml, function (err, result) {
            if (err) {
                callback(err);
            } else {
                let resources = _.isArray(result['DIDL-Lite'].item.res) ? result['DIDL-Lite'].item.res[0] : result['DIDL-Lite'].item.res;
                let res = _.isObject(resources) ? resources._ : resources;
                if (!res) {
                    callback(new Error('Error adding ' + trackDetailsXml));
                } else {
                    upnp.soapRequest(
                        deviceUrlRoot,
                        serviceList['urn:av-openhome-org:serviceId:Playlist'].controlUrl,
                        serviceList['urn:av-openhome-org:serviceId:Playlist'].serviceType,
                        'Insert',
                        '<AfterId>' + afterId + '</AfterId><Uri>' + encode(res) + '</Uri><Metadata>' + encode(trackDetailsXml) + '</Metadata>',
                        responseParser(parseNewId(callback))
                    ).on('error', callback);
                }
            }
        });
    };
    this.getSources = function (callback) {
        upnp.soapRequest(
            deviceUrlRoot,
            serviceList['urn:av-openhome-org:serviceId:Product'].controlUrl,
            serviceList['urn:av-openhome-org:serviceId:Product'].serviceType,
            'SourceXml',
            '',
            responseParser(toSourceList(callback))
        ).on('error', callback);
    };
    this.changeSource = function (source, callback) {
        upnp.soapRequest(
            deviceUrlRoot,
            serviceList['urn:av-openhome-org:serviceId:Product'].controlUrl,
            serviceList['urn:av-openhome-org:serviceId:Product'].serviceType,
            'SetSourceIndex',
            '<Value>'+source+'</Value>',
            ensureStatusCode(200, "Change Source", callback)
        ).on('error', callback);
    };
    this.standbyState = function (callback) {
        upnp.soapRequest(
            deviceUrlRoot,
            serviceList['urn:av-openhome-org:serviceId:Product'].controlUrl,
            serviceList['urn:av-openhome-org:serviceId:Product'].serviceType,
            'Standby',
            '',
            responseParser(parseStandbyResponse(callback))
        ).on('error', callback);
    };
    this.powerOn = function (callback) {
        upnp.soapRequest(
            deviceUrlRoot,
            serviceList['urn:av-openhome-org:serviceId:Product'].controlUrl,
            serviceList['urn:av-openhome-org:serviceId:Product'].serviceType,
            'SetStandby',
            '<Value>0</Value>',
            ensureStatusCode(200, "Power On", callback)
        ).on('error', callback);
    };
    this.powerOff = function (callback) {
        upnp.soapRequest(
            deviceUrlRoot,
            serviceList['urn:av-openhome-org:serviceId:Product'].controlUrl,
            serviceList['urn:av-openhome-org:serviceId:Product'].serviceType,
            'SetStandby',
            '<Value>1</Value>',
            ensureStatusCode(200, "Power Off", callback)
        ).on('error', callback);
    };
    this.playRadio = function (callback) {
        upnp.soapRequest(
            deviceUrlRoot,
            serviceList['urn:av-openhome-org:serviceId:Radio'].controlUrl,
            serviceList['urn:av-openhome-org:serviceId:Radio'].serviceType,
            'Play',
            '',
            ensureStatusCode(200, "Play Radio", callback)
        ).on('error', callback);
    };
    this.getRadioIdArray = function(callback) {
        if(!serviceList['urn:av-openhome-org:serviceId:Radio']) {
            let error = new Error('No Radio Service');
            error.statusCode = 404;
            callback(error);
        } else {
            upnp.soapRequest(
                deviceUrlRoot,
                serviceList['urn:av-openhome-org:serviceId:Radio'].controlUrl,
                serviceList['urn:av-openhome-org:serviceId:Radio'].serviceType,
                'IdArray',
                '',
                responseParser(binaryIdArrayToIntList(callback))
            ).on('error', callback);
        }
    };
    this.retrieveRadioStationDetails = function(idArray, callback) {
        let idArrayString = _.reduce(idArray, function (memo, num) { return memo + num + ' '; }, '').trim();
        upnp.soapRequest(
            deviceUrlRoot,
            serviceList['urn:av-openhome-org:serviceId:Radio'].controlUrl,
            serviceList['urn:av-openhome-org:serviceId:Radio'].serviceType,
            'ReadList',
            '<IdList>' + idArrayString + '</IdList>',
            responseParser(readChannelListResponseToTracks(callback))
        ).on('error', callback);
    };
    this.setRadioChannel = function(radioChannel, callback) {
        upnp.soapRequest(
            deviceUrlRoot,
            serviceList['urn:av-openhome-org:serviceId:Radio'].controlUrl,
            serviceList['urn:av-openhome-org:serviceId:Radio'].serviceType,
            'SetId',
            '<Value>' + radioChannel.id + '</Value><Uri>' + encode(radioChannel.uri) + '</Uri>',
            ensureStatusCode(200, "Set Radio Channel", callback)
        ).on('error', callback);
    };
    this.pause = (callback) => {
        upnp.soapRequest(
            deviceUrlRoot,
            serviceList['urn:av-openhome-org:serviceId:Playlist'].controlUrl,
            serviceList['urn:av-openhome-org:serviceId:Playlist'].serviceType,
            'Pause',
            '',
            ensureStatusCode(200, "Pause Track", callback)
        ).on('error', callback);
    };
    this.skipTrack = (callback) => {
        upnp.soapRequest(
            deviceUrlRoot,
            serviceList['urn:av-openhome-org:serviceId:Playlist'].controlUrl,
            serviceList['urn:av-openhome-org:serviceId:Playlist'].serviceType,
            'Next',
            '',
            ensureStatusCode(200, "Skip Track", callback)
        ).on('error', callback);
    };
    this.volumeInc = function (callback) {
        upnp.soapRequest(
            deviceUrlRoot,
            serviceList['urn:av-openhome-org:serviceId:Volume'].controlUrl,
            serviceList['urn:av-openhome-org:serviceId:Volume'].serviceType,
            'VolumeInc',
            '',
            ensureStatusCode(200, "Volume Increase", callback)
        ).on('error', callback);
    };
    this.volumeDec = function (callback) {
        upnp.soapRequest(
            deviceUrlRoot,
            serviceList['urn:av-openhome-org:serviceId:Volume'].controlUrl,
            serviceList['urn:av-openhome-org:serviceId:Volume'].serviceType,
            'VolumeDec',
            '',
            ensureStatusCode(200, "Volume Decrease", callback)
        ).on('error', callback);
    };
    this.currentTrackDetails = function(callback) {
        upnp.soapRequest(
            deviceUrlRoot,
            serviceList['urn:av-openhome-org:serviceId:Info'].controlUrl,
            serviceList['urn:av-openhome-org:serviceId:Info'].serviceType,
            'Track',
            '',
            responseParser(toTrack(callback))
        ).on('error', callback);
    };
};
