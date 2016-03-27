import IModel from './IModel';
import * as joi from 'joi';
import Document from './Document';

export default class ActionDocument implements IModel{
    getSchema(): joi.ObjectSchema{
        return joi.object();
    }
}
