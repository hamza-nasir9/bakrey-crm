import bcrypt from 'bcryptjs'
import { ActivityLog, Customer, Expense, InventoryItem, Order, Payment, Shift, Supplier } from '../models/BusinessModels.js'
import User from '../models/User.js'
import mongoose from 'mongoose'
const settingSchema = new mongoose.Schema({ key:{type:String,unique:true}, value:mongoose.Schema.Types.Mixed },{timestamps:true,versionKey:false});const notificationSchema=new mongoose.Schema({type:String,title:String,message:String,isRead:{type:Boolean,default:false},user:{type:mongoose.Schema.Types.ObjectId,ref:'User'}},{timestamps:true,versionKey:false});const backupSchema=new mongoose.Schema({backupId:{type:String,unique:true},createdBy:{type:mongoose.Schema.Types.ObjectId,ref:'User'},snapshot:mongoose.Schema.Types.Mixed},{timestamps:true,versionKey:false});const Setting=mongoose.models.Setting||mongoose.model('Setting',settingSchema);const Notification=mongoose.models.Notification||mongoose.model('Notification',notificationSchema);const Backup=mongoose.models.Backup||mongoose.model('Backup',backupSchema)
const defaults={businessName:'AL KAUSAR BAKREY',phone:'',whatsapp:'',email:'',address:'',currency:'PKR',timeZone:'Asia/Karachi',language:'English',shiftTimings:['06:00 AM – 12:00 PM','12:00 PM – 06:00 PM','06:00 PM – 12:00 AM','12:00 AM – 06:00 AM'],lowStockThreshold:0,prefixes:{order:'AKO-',customer:'AKC-',supplier:'AKS-',employee:'AKE-',inventory:'AKI-',payment:'AKP-',salary:'AKSAL-'}}
export async function getSettings(_,res,next){try{const row=await Setting.findOne({key:'system'}).lean();res.json({settings:{...defaults,...(row?.value||{})}})}catch(e){next(e)}}
export async function saveSettings(req,res,next){try{const settings={...defaults,...req.body};await Setting.findOneAndUpdate({key:'system'},{value:settings},{upsert:true,new:true});await ActivityLog.create({module:'Settings',action:'Settings updated',description:'Business and system settings updated.',actor:req.auth.sub});res.json({settings})}catch(e){next(e)}}
export async function notifications(req,res,next){try{const [low,pending,open]=await Promise.all([InventoryItem.find({isActive:true,$expr:{$lte:['$quantity','$lowStockThreshold']}}).select('itemName quantity').lean(),Order.countDocuments({remainingAmount:{$gt:0},status:{$ne:'Cancelled'}}),Shift.countDocuments({status:'Open'})]);const generated=[...low.map(x=>({type:'Low Stock',title:'Low stock alert',message:`${x.itemName}: ${x.quantity} units remaining.`})),...(pending?[{type:'Pending Payment',title:'Pending payments',message:`${pending} order(s) have outstanding balances.`}]:[]),...(open?[{type:'Shift Reminder',title:'Open shifts',message:`${open} shift(s) still require closing.`}]:[])];for(const item of generated){await Notification.updateOne({type:item.type,message:item.message,isRead:false},{$setOnInsert:item},{upsert:true})}const items=await Notification.find().sort({createdAt:-1}).limit(100).lean();res.json({notifications:items})}catch(e){next(e)}}
export async function markNotification(req,res,next){try{const item=await Notification.findByIdAndUpdate(req.params.id,{isRead:req.body.isRead!==false},{new:true});if(!item)return res.status(404).json({message:'Notification not found.'});res.json({notification:item})}catch(e){next(e)}}
export async function changeCredentials(req,res,next){try{const {password,pin}=req.body;if(!password&&!pin)return res.status(400).json({message:'Password or PIN is required.'});const update={};if(password){if(password.length<8)return res.status(400).json({message:'Password must contain at least 8 characters.'});update.passwordHash=await bcrypt.hash(password,12)}if(pin){if(!/^\d{4,8}$/.test(pin))return res.status(400).json({message:'PIN must contain 4–8 digits.'});update.pinHash=await bcrypt.hash(pin,12)}await User.findByIdAndUpdate(req.auth.sub,{...update,$inc:{tokenVersion:1}}); /* revokes other sessions; current client must sign in again */await ActivityLog.create({module:'Settings',action:'Credentials updated',description:'User credentials were updated.',actor:req.auth.sub});res.status(204).end()}catch(e){next(e)}}
export async function createBackup(req,res,next){try{const snapshot={customers:await Customer.find().lean(),suppliers:await Supplier.find().lean(),inventory:await InventoryItem.find().lean(),orders:await Order.find().lean(),payments:await Payment.find().lean(),expenses:await Expense.find().lean(),shifts:await Shift.find().lean()};const backup=await Backup.create({backupId:`AKBKP-${Date.now()}`,createdBy:req.auth.sub,snapshot});await ActivityLog.create({module:'Backup',action:'Manual backup created',description:`${backup.backupId} created.`,actor:req.auth.sub});res.status(201).json({backup:{id:backup._id,backupId:backup.backupId,createdAt:backup.createdAt}})}catch(e){next(e)}}
export async function listBackups(_,res,next){try{res.json({backups:await Backup.find().populate('createdBy','name').select('-snapshot').sort({createdAt:-1}).lean()})}catch(e){next(e)}}
export async function exportBackup(req,res,next){try{const backup=await Backup.findById(req.params.id).lean();if(!backup)return res.status(404).json({message:'Backup not found.'});res.setHeader('Content-Disposition',`attachment; filename="${backup.backupId}.json"`);res.json(backup)}catch(e){next(e)}}

/* ===================== v3: encrypted backups, notifications ===================== */
import { createEncryptedBackup } from '../services/backupService.js'
import { NotificationLog } from '../models/PlatformModels.js'
import { sendAlertDigest } from '../services/notificationService.js'

export async function runEncryptedBackup(req, res, next) {
  try {
    const result = await createEncryptedBackup()
    await ActivityLog.create({ module: 'System', action: 'Encrypted backup created', description: `${result.filename} (${result.bytes} bytes)${result.s3Url ? ' uploaded to S3.' : ' stored locally.'}`, actor: req.auth.sub }).catch(() => {})
    res.status(201).json({ backup: { filename: result.filename, bytes: result.bytes, s3Url: result.s3Url, collections: result.collections } })
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message })
    next(error)
  }
}

export async function listNotificationLogs(req, res, next) {
  try {
    const { page = 1, limit = 25 } = req.query
    const [logs, total] = await Promise.all([
      NotificationLog.find({}).sort({ occurredAt: -1 }).skip((Number(page) - 1) * Number(limit)).limit(Number(limit)).lean(),
      NotificationLog.countDocuments({}),
    ])
    res.json({ logs, total })
  } catch (error) { next(error) }
}

export async function runAlertDigest(req, res, next) {
  try {
    const { alerts, sent } = await sendAlertDigest()
    res.json({ sent, counts: alerts.summary, alerts })
  } catch (error) { next(error) }
}
